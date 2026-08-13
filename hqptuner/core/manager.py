"""Connection manager — single source of truth for daemon reachability.

Roadmap Phase 2.2 rules:
- "reachable" means a successful GetInfo handshake, not a mere TCP accept
- State/Status polling doubles as heartbeat (and keeps traffic under the
  daemon's ~156 s idle-drop window, protocol.md §1)
- unreachable beyond the alarm threshold (default 15 s; measured
  restart-to-GetInfo on Opal is 9.3 s) is surfaced as `alarm`
- poll aggressively during the initial outage window, then back off
- every fresh connection reloads all state from scratch: GetInfo, State,
  Status, enumerations, GET /config — no cached pre-outage state
- API reads never touch the socket; they serve the last snapshot (fail-fast)

Persistent config can change without an HQPTuner apply — an external preset
load, the output DAC changing, or HQPlayer's own web UI all rewrite the forms —
so the /config and /matrix snapshots are refetched every poll (best-effort on
the 8088 lane), not only on reconnect, and the frontend tracks reality instead
of a connect-time cache.
"""

import asyncio
import contextlib
import logging
import time
import zipfile
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.audit import AuditLog
from hqptuner.conf import engineconf, presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.applyops import ApplyOps
from hqptuner.engine import release
from hqptuner.engine.control import CommandError, ControlClient, ControlError
from hqptuner.lanes import devicelane, httpforms, livechain, livelane, settle
from hqptuner.presets import presetlane
from hqptuner.presets.presetops import PresetOps
from hqptuner.presets.presetstore import PresetError

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
        # Bumped on every completed connect handshake. A restore returns 200 before
        # the daemon restarts, and the departing process keeps answering for
        # seconds — so "a daemon answered" cannot tell the two apart and this can:
        # a different generation is a different process (``await_restart``).
        self._generation = 0
        # Serializes connects. The poll loop is no longer the only path that brings
        # a connection up — ``await_restart`` does it too, on its own clock — and two
        # tasks connecting at once would leave one client orphaned and unclosed.
        self._connecting = asyncio.Lock()
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

        self.info: dict[str, str] | None = None
        # installed release string off the 8088 /about page (engine/release.py);
        # "" until read, and stays "" when the page is unreachable or unparseable.
        self.release: str = ""
        self.license: dict[str, str] | None = None
        self.state: dict[str, str] | None = None
        self.status: dict[str, str] | None = None
        self.status_metadata: dict[str, str] | None = None
        self.volume_range: dict[str, str] | None = None
        self.engine: dict[str, str] | None = None
        self.active_config: str | None = None
        self.enums: dict[str, list[dict[str, str]]] | None = None
        # What LIVE set that the engine cannot hold on to by itself — the dormant
        # family's rate pin and the dormant chain's filters (`lanes/livelane`).
        self.live = livelane.LiveMemory()
        # The 4322 metering reader (junk-filter advisor). Owned and started by
        # the app lifespan; held here so the status route can ask for advice.
        self.metering: MeteringReader | None = None
        self.config_form: dict[str, Any] | None = None
        self.config_error: str | None = None
        self.matrix_form: dict[str, Any] | None = None
        self.matrix_error: str | None = None
        # Speaker processing form (readme §1.9), a top-level config element absent
        # from /config — polled over the 8088 lane like /matrix, best-effort.
        self.speakers_form: dict[str, Any] | None = None
        self.speakers_error: str | None = None
        # Saved matrix profile names from the live 4321 lane (MatrixListProfiles —
        # unauthenticated, no reload). The active one is State.matrix_profile.
        self.matrix_profiles: list[str] | None = None
        self.loaded_at: float | None = None
        # Running config read from the config FILE (the /backup archive's working
        # hqplayerd.xml), in form-field terms. The /config form is lossy for
        # settings whose XML domain is wider than the widget the daemon renders —
        # volume_fixed is 0/1/2 in the XML but a plain checkbox on the form, so the
        # form cannot distinguish -3 dB from -6 dB. Fields flagged `fileTruth` in
        # the frontend schema read their baseline from here instead. Refreshed on
        # connect and after every persistent apply (never per-poll: /backup is ~5 MB).
        self.file_config: dict[str, str] | None = None
        # What the selected output device announced it can carry, with the selection and
        # clock its refresh reads (lanes/devicelane); None narrows no menu.
        self.device_caps: dict[str, Any] | None = None
        self.caps_device: str | None = None
        self.caps_at: float = 0.0

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
        async with self._connecting:
            if self._client is not None:
                return  # another task got there first; its handshake is this one's answer
            await self._connect_and_load_locked()

    async def _connect_and_load_locked(self) -> None:
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
        self.info, self.state, self.status, self.status_metadata = info, state, status, meta
        self.license = license_info
        self.active_config = active_config
        self.volume_range = vrange
        self.enums = enums
        self.matrix_profiles = matrix_profiles
        self.live.forget()
        self.loaded_at = time.time()
        self._generation += 1
        self.reachable = True
        self.unreachable_since = None
        # best-effort and credential-free: /about is not gated, and fetch_release
        # answers any failure with "" — reachability is already decided above.
        self.release = await release.fetch_release(self.http_base_url)
        if self._http is not None:
            # best-effort 8088 lane — a failure here must not undo the 4321 connect.
            # refresh_http_forms populates config/matrix/speakers (+ their *_error).
            await self.refresh_http_forms()
            await devicelane.refresh_caps(self, force=True)
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
        previous = self.state or {}
        moved = self.state is not None and any(state.get(a) != previous.get(a) for a in ("mode", "state"))
        if moved:
            log.info("engine moved (mode %s, state %s), re-enumerating", state.get("mode"), state.get("state"))
            self.enums = await client.get_all_enumerations()
        status, meta = await client.get_status()
        before = livechain.active_chain(self)
        self.state, self.status, self.status_metadata = state, status, meta
        await livelane.chain_entered(self, client, before, reenumerated=moved)
        self.volume_range = await client.get_volume_range()
        with contextlib.suppress(CommandError):  # profile saves/deletes land without an apply
            self.matrix_profiles = await client.get_matrix_profiles()
        # external changes (preset loads, the DAC changing, HQPlayer's own UI)
        # rewrite the http forms without any HQPTuner apply — refetch each poll so
        # the config/matrix snapshots track reality instead of only connect-time.
        await self.refresh_http_forms()
        self.loaded_at = time.time()

    async def resync_engine_state(self) -> None:
        """Re-read the engine after something restarted it, so nothing reads the old engine's answers.

        ``state``, ``enums`` and ``live`` all describe a daemon process that is gone the moment a restore
        restarts it, and only the poll loop refreshes them — a second later. Anything reading in between
        (``liveoverrides.live_overrides``, and so every save and auto-save) reports the settings of the
        engine that was running BEFORE the restart and writes them into the preset that just replaced it.

        Invalidated first and refilled second on purpose: the fetch can fail, and a reader that lands on
        ``state = None`` overlays nothing, which stores the config as loaded. Stale answers are the one
        outcome this must never leave behind.

        The refill waits for the restart to actually happen (``await_restart``). Re-reading on the
        restore's own 200 answered from the departing process and refilled with exactly the stale
        settings this exists to discard — the preset switch that stored the previous preset's
        modulator was that window, 200 ms wide against a restart of several seconds. A boundary that
        never arrives leaves the invalidation standing.
        """
        self.live.forget()
        self.state = None
        if not await self.await_restart():
            log.warning("engine resync: no restarted daemon within the deadline, live state left invalid")
            return
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
        self.state, self.enums = state, enums

    async def refresh_http_forms(self) -> None:
        """Refresh the three polled 8088 form snapshots (lanes/httpforms) and the device capability.

        The capability hangs off those forms; ``lanes/devicelane.refresh_caps`` says why.
        """
        await httpforms.refresh(self)
        await devicelane.refresh_caps(self)

    async def read_preset(self, name: str) -> dict[str, str]:
        """Return a stored preset's saved settings in form-field terms without loading it.

        The empty name means "(no preset)" and returns the running config instead.
        """
        return await presetlane.read(self, name)

    # --- accessors for the extracted lanes --------------------------------

    @property
    def http_client(self) -> HttpConfigClient | None:
        """Return the 8088 config client, or None when no management credentials were configured."""
        return self._http

    @property
    def http_base_url(self) -> str:
        """Return the base URL of the daemon's 8088 web interface, which the read lanes fetch from."""
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

    async def await_restart(self) -> bool:
        """Wait until the daemon process running at call time is gone and a new one has answered.

        ``POST /restore`` returns 200 when the archive is on disk, and the daemon restarts *after*
        that (~5.6 s, docs/protocol.md) — the departing process keeps serving both lanes meanwhile.
        So neither a 200 nor ``await_http_ready`` says the restart happened, and anything that
        re-reads the engine on that evidence reads the process it just replaced.

        The boundary that is actually observable is the Control API connection: it breaks when the
        process exits, and the connect that replaces it counts a new generation. Both halves are done
        here rather than left to the poll loop — the probe is what discovers the socket is dead
        between ticks, and the reconnect is what proves a NEW process answers. Leaving either to the
        loop makes this wait depend on that loop's cadence to reach its own verdict.

        False when no new process answered before the alarm deadline. That is 'the engine cannot be
        trusted', never 'the restart happened' — callers leave their live state invalid rather than
        refill it from whatever is still answering.

        True at once when there is no Control API connection to observe: nothing can be read off an
        engine we are not connected to, so there is nothing for the boundary to protect — the resync
        returns early and the overlays are empty either way. Waiting out the deadline there would
        refuse every apply whenever 4321 is down while 8088 still serves, which is a working write
        path traded for a guarantee that had nothing left to guard.
        """
        if self._client is None:
            return True
        start = self._generation

        async def probe() -> bool:
            if self._generation != start:
                return True
            client = self._client
            if client is not None:
                try:
                    await client.get_info()
                except (ControlError, OSError):
                    await self._drop("restart in progress")
                else:
                    return False  # the process that took the restore is still answering
            with contextlib.suppress(*_WIRE_FAULTS):
                await self._connect_and_load()  # whatever answers now is a new process
            return self._generation != start

        return bool(await settle.poll_until(self, probe, interval=RECONNECT_FAST))

    async def read_engine(self) -> dict[str, str]:
        """Return current hardware-accel engine attributes, parsed from a fresh backup's base config.

        That backup is the only lane that carries them — they are not on the form. Fetched on
        demand, not per poll, since the backup archive is large.
        """
        engine = engineconf.read_engine_attrs(
            engineconf.base_config_xml(await self.presetops.backup_or_cached(), self.active_config)
        )
        self.engine = engine
        return engine

    async def load_file_config(self) -> dict[str, str]:
        """Read running config from the backup archive's working ``hqplayerd.xml``, in form-field terms.

        Serves the fields the ``/config`` form renders lossily (``volume_fixed``: 0/1/2 in XML, a
        bare checkbox on the form). Fetched on connect and refreshed by the apply's verify step —
        never per poll, since the archive is large.
        """
        backup = await self.presetops.backup_or_cached()
        self.file_config = presetconf.read_config(engineconf.base_config_xml(backup, self.active_config))
        return self.file_config

    async def read_log_tail(self, lines: int = 50) -> dict[str, Any]:
        """Return a static tail of the daemon's log for the System-tab live view (lanes/devicelane)."""
        return await devicelane.read_log_tail(self, lines)

    async def restore_config(self, data: bytes, scope: str = "system") -> None:
        """Restore a user-supplied settings archive as-is (the System-tab restore action).

        The daemon self-restarts, interrupting playback if any.
        """
        await self.require_http().restore(data, scope=scope)

    @property
    def control(self) -> ControlClient | None:
        """The live 4321 client, for the extracted lanes (None while unreachable)."""
        return self._client

    async def refresh_devices(self) -> dict[str, Any]:
        """Trigger a daemon output-device re-scan and refetch the forms it moves (lanes/devicelane)."""
        return await devicelane.refresh_devices(self)

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 config client, raising ControlError when no credentials were configured.

        The accessor every write lane that cannot proceed without the HTTP lane uses instead of ``http_client``.
        """
        if self._http is None:
            raise ControlError("no credentials for HTTP config lane")
        return self._http

    def current_mode_name(self) -> str:
        """Return the name the engine's mode enumeration gives State's mode index, or "" if either is missing."""
        if not self.state or not self.enums:
            return ""
        idx = self.state.get("mode", "")
        for item in self.enums.get("modes", []):
            if item.get("index") == idx:
                return item.get("name", "")
        return ""
