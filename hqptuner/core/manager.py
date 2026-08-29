"""Connection manager — single source of truth for daemon reachability.

Roadmap Phase 2.2 rules:
- "reachable" means a successful GetInfo handshake, not a mere TCP accept
- State/Status polling doubles as heartbeat (and keeps traffic under the
  daemon's ~156 s idle-drop window, protocol.md §1)
- unreachable beyond the alarm threshold (default 15 s; measured
  restart-to-GetInfo on Opal is 9.3 s) is surfaced as `alarm`
- poll aggressively during the initial outage window, then back off
- API reads never touch the socket; they serve the last snapshot (fail-fast)

What the daemon told us lives in ``core/readings``; what the engine is asked to
read on demand lives in ``core/engineread``. This file is the supervisor: it owns
the socket, decides what "reachable" means, and refills those readings.
"""

import asyncio
import contextlib
import logging
import time
import zipfile
from typing import TYPE_CHECKING

import httpx

from hqptuner.audit import AuditLog
from hqptuner.conf import engineconf, presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.applyops import ApplyOps
from hqptuner.core.readings import Readings
from hqptuner.engine import release
from hqptuner.engine.control import CommandError, ControlClient, ControlError
from hqptuner.lanes import settle
from hqptuner.lanes.http import forms
from hqptuner.lanes.live import chain, lane
from hqptuner.presets.presetops import PresetOps
from hqptuner.presets.store.presets import PresetError

if TYPE_CHECKING:
    from hqptuner.engine.metering import MeteringReader

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0
# What the supervisor loop treats as "the daemon, not us": a refused or severed socket, a
# timeout, a non-2xx on the 8088 lane, a command the engine rejected. These are the faults
# `daemon unreachable` is an honest report of. Anything outside this set is a bug of ours,
# and the loop's second clause keeps it loud instead of dressing it as an outage.
_WIRE_FAULTS = (ControlError, CommandError, httpx.HTTPError, OSError, TimeoutError)


class ConnectionManager:
    """Hold the daemon connection and the last loaded snapshot every API read and write lane serves from."""

    def __init__(self, cfg: Config, http_client: HttpConfigClient | None = None) -> None:
        """Build the audit log, preset and apply collaborators, and start unreachable with every snapshot empty."""
        self._cfg = cfg
        self._http = http_client
        self._client: ControlClient | None = None
        self._stop = asyncio.Event()
        # The one audit log (audit.py). ONE instance, built before anything that
        # writes through it: each instance resumes its sequence counter from the
        # file, so a second copy would hand out numbers the first already used.
        self.audit = AuditLog(cfg.debug_log)
        # Preset lifecycle + filter parking + backup persistence (presetops).
        self.presetops = PresetOps(cfg, self)
        # Apply/dispatch operations (applyops).
        self.applyops = ApplyOps(self)

        self.reachable = False
        self.unreachable_since: float | None = time.time()
        self._unreachable_mono: float = time.monotonic()

        # Everything the daemon last told us (core/readings). Refilled from scratch
        # on every fresh connection; read by every route and lane.
        self.readings = Readings()
        # The 4322 metering reader (junk-filter advisor). Owned and started by
        # the app lifespan; held here so the status route can ask for advice.
        self.metering: MeteringReader | None = None

    @property
    def alarm(self) -> bool:
        """Report whether the daemon has been unreachable for longer than the alarm threshold."""
        return not self.reachable and self.monotonic() - self._unreachable_mono > self._cfg.alarm_threshold

    def stop(self) -> None:
        """Signal the poll loop to leave its next wait and finish; does not close the socket (see ``aclose``)."""
        self._stop.set()

    async def aclose(self) -> None:
        """Shut down cleanly: stop the loop and close the control connection so no socket dangles.

        The caller awaits the run() task separately.
        """
        self.stop()
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def run(self) -> None:
        """Run the connect-load-poll loop until stopped, dropping the connection and retrying on any failure.

        Retries fast inside the expected restart window and backs off to ``RECONNECT_SLOW`` once in alarm.
        """
        while not self._stop.is_set():
            if self._client is None:
                try:
                    await self._connect_and_load()
                except _WIRE_FAULTS as exc:
                    await self._drop(f"connect/load failed: {exc}")
                    await self._sleep(self._reconnect_delay())
                    continue
                except Exception:  # noqa: BLE001 — see _bug(): the loop must outlive our own bugs, loudly
                    self._bug("connect/load")
                    await self._sleep(self._reconnect_delay())
                    continue
            try:
                await self._poll()
            except _WIRE_FAULTS as exc:
                await self._drop(f"poll failed: {exc}")
                continue
            except Exception:  # noqa: BLE001 — see _bug(): the loop must outlive our own bugs, loudly
                self._bug("poll")
                await self._sleep(self._cfg.poll_interval)
                continue
            await self._sleep(self._cfg.poll_interval)

    def _reconnect_delay(self) -> float:
        """Retry aggressively inside the expected-restart window, then back off once in alarm."""
        return RECONNECT_FAST if not self.alarm else RECONNECT_SLOW

    def _bug(self, stage: str) -> None:
        """Report a fault that is ours, not the daemon's, and leave reachability alone.

        The blind ``except`` above this is deliberate and stays: ``run()`` is started with
        ``create_task`` and never awaited until shutdown, so an escaping exception surfaces
        nowhere at all — the supervisor would die in silence while the API kept serving. What
        changes is that a fault outside ``_WIRE_FAULTS`` no longer reaches ``_drop``, which
        logs at most once per outage and would report our own ``TypeError`` as the daemon
        being unreachable. Every iteration logs a traceback instead, and the connection is
        left as it was: nothing here is evidence the daemon went away.
        """
        log.exception("%s failed with a fault of ours, not the daemon's; retrying", stage)

    async def _sleep(self, seconds: float) -> None:
        """Perform the poll loop's own wait.

        NOT a duplicate of the public ``sleep``: the test suite virtualizes ``sleep``
        (docs/testing.md §7) so lane deadlines cost no wall clock, and deliberately leaves this one
        alone so a running manager polls at its real interval instead of spinning.
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stop.wait(), seconds)

    async def _drop(self, reason: str) -> None:
        if self.reachable or self._client is not None:
            log.warning("daemon unreachable: %s", reason)
        if self.reachable:
            self.unreachable_since = time.time()
            self._unreachable_mono = time.monotonic()
        self.reachable = False
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def _connect_and_load(self) -> None:
        client = ControlClient(self._cfg.hqp_host, self._cfg.hqp_control_port, self._cfg.request_timeout)
        await client.connect()
        info = await client.get_info()  # the handshake — this defines "reachable"
        license_info = await client.get_license()  # static; licensee + valid flag
        active_config = await client.get_active_config()  # active preset name
        state = await client.get_state()
        status, meta = await client.get_status()
        vrange = await client.get_volume_range()
        enums = await client.get_all_enumerations()
        matrix_profiles: list[str] | None = None
        with contextlib.suppress(CommandError):  # older engines may not speak Matrix*
            matrix_profiles = await client.get_matrix_profiles()

        self._client = client
        readings = self.readings
        readings.info, readings.state, readings.status, readings.status_metadata = info, state, status, meta
        readings.license = license_info
        readings.active_config = active_config
        readings.volume_range = vrange
        readings.enums = enums
        readings.matrix_profiles = matrix_profiles
        readings.live.forget()
        readings.loaded_at = time.time()
        self.reachable = True
        self.unreachable_since = None
        # best-effort and credential-free: /about is not gated, and fetch_release
        # answers any failure with "" — reachability is already decided above.
        readings.release = await release.fetch_release(self.http_base_url)
        if self._http is not None:
            # best-effort 8088 lane — a failure here must not undo the 4321 connect.
            # refresh_http_forms populates config/matrix/speakers (+ their *_error).
            await self.refresh_http_forms()
            await engineread.refresh_device_caps(self, force=True)
            try:
                await self.load_file_config()
            except (httpx.HTTPError, ControlError) as exc:
                # the form still carries every field; only the lossy ones degrade.
                # A corrupt archive is not in this set on purpose: engineconf.base_config_xml
                # already answers unreadable bytes with b"", so BadZipFile cannot arrive here.
                log.warning("file-config read failed: %s", exc)
            try:
                await self.presetops.migrate_once(active_config)
            except (httpx.HTTPError, PresetError, OSError, zipfile.BadZipFile) as exc:
                # the daemon's own snapshots stay unimported; the store keeps whatever it had.
                # BadZipFile belongs here and not above: presetzip.snapshot_members opens the
                # archive itself, with no empty-bytes fallback under it.
                log.warning("preset migration skipped: %s", exc)
        log.info("connected: %s engine %s", info.get("name"), info.get("engine") or info.get("version"))

    async def _poll(self) -> None:
        client = self._client
        if client is None:
            raise ControlError("not connected")
        state = await client.get_state()
        # A mode switch swaps the lists wholesale (architecture §5), and playback
        # state moves the rate list: what fills that one is the transport as well
        # as the mode (manual p.18 §4.4), so an idle network backend answers
        # GetRates with auto alone where the same daemon serves thirteen PCM tiers
        # once asked again (verified live on 6.0.4) — and the page grayed every tier.
        readings = self.readings
        previous = readings.state or {}
        moved = readings.state is not None and any(state.get(a) != previous.get(a) for a in ("mode", "state"))
        if moved:
            log.info("engine moved (mode %s, state %s), re-enumerating", state.get("mode"), state.get("state"))
            readings.enums = await client.get_all_enumerations()
        status, meta = await client.get_status()
        before = chain.active_chain(self)
        readings.state, readings.status, readings.status_metadata = state, status, meta
        await lane.chain_entered(self, client, before, reenumerated=moved)
        readings.volume_range = await client.get_volume_range()
        with contextlib.suppress(CommandError):  # profile saves/deletes land without an apply
            readings.matrix_profiles = await client.get_matrix_profiles()
        # external changes (preset loads, the DAC changing, HQPlayer's own UI)
        # rewrite the http forms without any HQPTuner apply — refetch each poll so
        # the config/matrix snapshots track reality instead of only connect-time.
        await self.refresh_http_forms()
        readings.loaded_at = time.time()

    async def resync_engine_state(self) -> None:
        """Re-read the engine after something restarted it, so nothing reads the old engine's answers.

        ``state``, ``enums`` and ``live`` all describe a daemon process that is gone the moment a restore
        restarts it, and only the poll loop refreshes them — a second later. Anything reading in between
        (``overrides.live_overrides``, and so every save and auto-save) reports the settings of the
        engine that was running BEFORE the restart and writes them into the preset that just replaced it.

        Invalidated first and refilled second on purpose: the fetch can fail, and a reader that lands on
        ``state = None`` overlays nothing, which stores the config as loaded. Stale answers are the one
        outcome this must never leave behind.
        """
        self.readings.live.forget()
        self.readings.state = None
        client = self._client
        if client is None:
            return
        try:
            state = await client.get_state()
            enums = await client.get_all_enumerations()
        except ControlError as exc:
            # the poll loop's own reconnect refills both; until then None is the honest answer
            log.warning("engine resync after restart failed: %s", exc)
            return
        self.readings.state, self.readings.enums = state, enums

    async def refresh_http_forms(self) -> None:
        """Refresh the three polled 8088 form snapshots (lanes/http/forms) and the device capability.

        The capability hangs off those forms: it is read for whichever device the config form says
        is selected, so it belongs wherever that form is refreshed — the poll loop, connect, and the
        rescan route alike — rather than at the poll loop alone, which leaves every other path
        serving a stale answer or none.
        """
        await forms.refresh(self)
        await engineread.refresh_device_caps(self)

    # --- accessors for the extracted write lanes --------------------------

    @property
    def http_client(self) -> HttpConfigClient | None:
        """Return the 8088 config client, or None when no management credentials were configured."""
        return self._http

    async def read_engine(self) -> dict[str, str]:
        """Return current hardware-accel engine attributes, parsed from a fresh backup's base config.

        That backup is the only lane that carries them — they are not on the form. Fetched on
        demand, not per poll, since the backup archive is large.

        Here rather than in ``core/engineread`` because ``presets`` calls its sibling below and
        sits under ``core`` in the layering contract: it reaches an attribute, never an import.
        """
        readings = self.readings
        readings.engine = engineconf.read_engine_attrs(
            engineconf.base_config_xml(await self.presetops.backup_or_cached(), readings.active_config)
        )
        return readings.engine

    async def load_file_config(self) -> dict[str, str]:
        """Read running config from the backup archive's working ``hqplayerd.xml``, in form-field terms.

        Serves the fields the ``/config`` form renders lossily (``volume_fixed``: 0/1/2 in XML, a
        bare checkbox on the form). Fetched on connect and refreshed by the apply's verify step —
        never per poll, since the archive is large.
        """
        backup = await self.presetops.backup_or_cached()
        self.readings.file_config = presetconf.read_config(
            engineconf.base_config_xml(backup, self.readings.active_config)
        )
        return self.readings.file_config

    @property
    def http_base_url(self) -> str:
        """Return the daemon's 8088 web root, which the ungated readers (/about, /log) fetch from."""
        return f"http://{self._cfg.hqp_host}:{self._cfg.hqp_http_port}"

    @property
    def alarm_threshold(self) -> float:
        """Return the configured unreachable-to-alarm seconds, which the lanes reuse as their default deadline."""
        return self._cfg.alarm_threshold

    def monotonic(self) -> float:
        """Read the lanes' clock.

        A method, not ``time.monotonic`` inline, because it is the seam the suite virtualizes
        alongside ``sleep`` (docs/testing.md).
        """
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        """Perform the lanes' wait — virtualized in tests.

        See ``_sleep`` for why the poll loop deliberately does not share it.
        """
        await self._sleep(seconds)

    async def await_http_ready(self) -> bool:
        """Wait until the HTTP config lane serves again.

        The daemon restarts on a preset load and on every restore, and its active label flips before
        the restart completes — so callers must not assume 'label switched' means 'ready to write'.
        """

        async def probe() -> bool:
            await self.require_http().get_config()
            return True

        return bool(await settle.poll_until(self, probe, interval=RECONNECT_FAST))

    @property
    def control(self) -> ControlClient | None:
        """The live 4321 client, for the extracted lanes (None while unreachable)."""
        return self._client

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 config client, raising ControlError when no credentials were configured.

        The accessor every write lane that cannot proceed without the HTTP lane uses instead of ``http_client``.
        """
        if self._http is None:
            raise ControlError("no credentials for HTTP config lane")
        return self._http
