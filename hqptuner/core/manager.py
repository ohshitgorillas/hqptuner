"""Connection manager — single source of truth for daemon reachability.

Roadmap Phase 2.2 rules:
- "reachable" means a successful GetInfo handshake, not a mere TCP accept
- State/Status polling doubles as heartbeat (and keeps traffic under the
  daemon's ~156 s idle-drop window, protocol.md §1)
- unreachable beyond the alarm threshold (default 15 s; measured
  restart-to-GetInfo on Opal is 9.3 s) is surfaced as `alarm`
- poll aggressively during the initial outage window, then back off
- API reads never touch the socket; they serve the last snapshot (fail-fast)

This file is the composition root: it builds the collaborators, holds the lifecycle
flags, runs the supervisor loop, and carries the clock seams and client accessors
every lane reaches the daemon through. Nothing here fills a reading on demand.
What the daemon told us lives in ``core/readings``; the connect and poll bodies
that refill it live in ``core/loader``; post-restart resyncs and waits in
``lanes/settle``; backup-archive readers in ``presets/fileconfig``; engine readers
in ``core/engineread``.
"""

import asyncio
import contextlib
import logging
import time
from typing import TYPE_CHECKING

import httpx

from hqptuner.audit import AuditLog
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core import engineread, loader
from hqptuner.core.applyops import ApplyOps
from hqptuner.core.readings import Readings
from hqptuner.engine.control import CommandError, ControlClient, ControlError
from hqptuner.lanes.http import forms
from hqptuner.presets.presetops import PresetOps

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
        self.cfg = cfg
        self._http = http_client
        self._client: ControlClient | None = None
        self._stop = asyncio.Event()
        # `_wake` pulls the poll loop out of its wait early (see `restarting`);
        # `connected` is set at the end of every connect body and cleared on every
        # drop, the thing a post-restore wait (lanes.settle.await_ready) sleeps on.
        self._wake = asyncio.Event()
        self.connected = asyncio.Event()
        # Set on every edge of `connected`, both directions, and cleared by whoever
        # waits on it. `connected` alone cannot wake a waiter on a drop, and a
        # post-restore wait needs the drop as much as the connect that follows it.
        self.changed = asyncio.Event()
        # The one audit log (audit.py). ONE instance, built before anything that
        # writes through it: each instance resumes its sequence counter from the
        # file, so a second copy would hand out numbers the first already used.
        self.audit = AuditLog(cfg.debug_log)
        # Preset lifecycle + filter parking + backup persistence (presetops).
        self.presetops = PresetOps(cfg, self)
        # Apply/dispatch operations (applyops).
        self.applyops = ApplyOps(self)

        self.reachable = False
        # Whole connects completed since construction: a post-restore wait's mark, so
        # it waits for a connect that completed after its restore began.
        self.connects = 0
        # Drops that were evidence the daemon went away, since construction. The
        # forced drop `restarting` takes is not one: it is our own doing, ahead of a
        # restart the daemon has not performed yet, so counting it would let a
        # post-restore wait mistake it for the restart landing.
        self.drops = 0
        self.unreachable_since: float | None = time.time()
        # Stamped through `monotonic()`, the seam `alarm` reads it back through, so
        # both sides of that subtraction run on one clock (virtual in the suite).
        self._unreachable_mono: float = self.monotonic()

        # Everything the daemon last told us (core/readings). Refilled from scratch
        # on every fresh connection; read by every route and lane.
        self.readings = Readings()
        # The 4322 metering reader (junk-filter advisor). Owned and started by
        # the app lifespan; held here so the status route can ask for advice.
        self.metering: MeteringReader | None = None

    @property
    def ready(self) -> bool:
        """Report whether both daemon lanes are up: the connect body completed and stands, and 8088 answered.

        Not a flag anyone sets. `reachable` is the 4321 handshake alone, published before
        the 8088 half of the connect has run, and a flag set at the end of the connect body
        went on reading true for a configuration lane that was refused or never built.
        """
        return self.connected.is_set() and self.readings.http_ok

    @property
    def alarm(self) -> bool:
        """Report whether the daemon has been unreachable for longer than the alarm threshold."""
        return not self.reachable and self.monotonic() - self._unreachable_mono > self.cfg.alarm_threshold

    def stop(self) -> None:
        """Signal the poll loop to leave its next wait and finish; does not close the socket (see ``aclose``)."""
        self._stop.set()
        self._wake.set()

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
                    await loader.connect_and_load(self)
                except _WIRE_FAULTS as exc:
                    await self._drop(f"connect/load failed: {exc}")
                    await self._sleep(self._reconnect_delay())
                    continue
                except Exception:  # noqa: BLE001 — see _bug(): the loop must outlive our own bugs, loudly
                    self._bug("connect/load")
                    await self._sleep(self._reconnect_delay())
                    continue
            try:
                await loader.poll(self)
            except _WIRE_FAULTS as exc:
                await self._drop(f"poll failed: {exc}")
                continue
            except Exception:  # noqa: BLE001 — see _bug(): the loop must outlive our own bugs, loudly
                self._bug("poll")
                await self._sleep(self.cfg.poll_interval)
                continue
            await self._sleep(self.cfg.poll_interval)

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

        ``_wake`` cuts the wait short: ``restore`` sets it after dropping the control lane so the
        reconnect starts at once, and ``stop`` sets it so shutdown never waits out a poll interval.
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), seconds)
        self._wake.clear()

    async def _drop(self, reason: str, *, counts: bool = True) -> None:
        """Tear the control connection down.

        ``counts`` is False for the one drop that is not evidence the daemon went away:
        ``restarting`` takes the connection down itself, ahead of a restart the daemon has
        not begun, and a post-restore wait that counted it would return on the connection
        the restart is about to kill.
        """
        if self.reachable or self._client is not None:
            log.warning("daemon unreachable: %s", reason)
        if self.reachable:
            self.unreachable_since = time.time()
            self._unreachable_mono = self.monotonic()
        if counts and self.connected.is_set():
            self.drops += 1
        self.reachable = False
        self.connected.clear()
        self.changed.set()
        if self._client is not None:
            await self._client.close()
            self._client = None

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

    @property
    def http_base_url(self) -> str:
        """Return the daemon's 8088 web root, which the ungated readers (/about, /log) fetch from."""
        return f"http://{self.cfg.hqp_host}:{self.cfg.hqp_http_port}"

    @property
    def alarm_threshold(self) -> float:
        """Return the configured unreachable-to-alarm seconds, which the lanes reuse as their default deadline."""
        return self.cfg.alarm_threshold

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

    async def restarting(self) -> None:
        """Drop the control lane a restore just killed and start the reconnect now.

        The daemon self-restarts on every adopted restore (architecture §1 lane 2), so the 4321
        socket is dead the moment the POST returns. Waiting for the poll loop to find that out costs
        up to a poll interval; dropping here and waking the loop starts the reconnect at once, and
        the loop's own retries carry it through the restart window. The post-restore wait itself is
        ``lanes.settle.await_ready``.

        Only a whole connection is dropped: with ``connected`` clear there is either no client, or
        a connect body mid-flight that must finish on its own client rather than one closed under
        it. It reads ``connected`` rather than ``ready`` because the configuration lane has no say
        in whether there is a control connection here to take down.

        The drop does not count: it is ours, taken ahead of a restart the daemon has not performed,
        and ``await_ready`` waits for a counting drop to prove the restart actually landed.
        """
        if self.connected.is_set():
            await self._drop("restore restarts the daemon", counts=False)
            self._wake.set()

    @property
    def control(self) -> ControlClient | None:
        """The live 4321 client, for the extracted lanes (None while unreachable)."""
        return self._client

    @control.setter
    def control(self, client: ControlClient | None) -> None:
        """Attach the client ``core/loader`` just connected, so ``_drop`` owns closing it from here on."""
        self._client = client

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 config client, raising ControlError when no credentials were configured.

        The accessor every write lane that cannot proceed without the HTTP lane uses instead of ``http_client``.
        """
        if self._http is None:
            raise ControlError("no credentials for HTTP config lane")
        return self._http
