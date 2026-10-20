"""The connection manager: the one object the app holds the daemon through."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

import httpx

from hqptuner.audit import AuditLog
from hqptuner.clock import Clock
from hqptuner.conf.httpauth import NoHttpClientError
from hqptuner.core import engineread, loader
from hqptuner.core.applyops import ApplyOps
from hqptuner.core.lifecycle import Fact, Lifecycle, Phase
from hqptuner.core.readings import Readings
from hqptuner.engine.controlerrors import ControlConnectionFailedError, ControlError
from hqptuner.engine.logtail import LogReader
from hqptuner.lanes.http import forms
from hqptuner.presets.presetops import PresetOps

if TYPE_CHECKING:
    from hqptuner.conf.httpconf import HttpConfigClient
    from hqptuner.config import Config
    from hqptuner.engine.control import ControlClient
    from hqptuner.engine.metering import MeteringReader
    from hqptuner.lanes.http.forms import FormsOutcome

log = logging.getLogger(__name__)

#: Seconds on ``mgr.clock`` before the connect loop is entered again after a fault: inside the window, and once the
#: phase is Alarm.
RECONNECT_FAST = 1.0
RECONNECT_SLOW = 5.0

#: The faults that are the daemon's: a refused or severed socket, a timeout, a non-2xx on 8088, a command the
#: engine rejected. Anything else that ends the connect loop is a fault of ours.
_WIRE_FAULTS = (ControlError, httpx.HTTPError, OSError, TimeoutError)


def reconnect_delay(phase: Phase) -> float:
    """Return how long to wait before entering the connect loop again: fast inside the window, slow once in Alarm."""
    return RECONNECT_SLOW if phase is Phase.ALARM else RECONNECT_FAST


class _Supervisor:
    """Keeps one manager's connect loop running until stopped, entering it again after each fault ends it."""

    def __init__(self, mgr: ConnectionManager) -> None:
        """Bind the manager and raise no stop yet, so a ``stop`` that comes before ``run`` still ends it."""
        self._mgr = mgr
        self._stopped = False
        self._wake = asyncio.Event()

    def stop(self) -> None:
        """End ``run`` at its next wait, cutting that wait short."""
        self._stopped = True
        self._wake.set()

    def redial(self) -> None:
        """End the connect loop at its next wait, cutting that wait short, so it is entered again and dials at once."""
        self._wake.set()

    async def run(self) -> None:
        """Drive the connect loop until stopped; a fault is logged as the daemon's or as ours, then retried."""
        mgr, wake = self._mgr, self._wake
        while not self._stopped:
            wake.clear()
            try:
                await loader.run(mgr, wake)
            except _WIRE_FAULTS as exc:
                log.warning("the daemon ended the connect loop; retrying: %s", exc)
                await self._idle()
            except Exception:
                log.exception("the connect loop failed with a fault of ours, not the daemon's; retrying")
                await self._idle()

    async def _idle(self) -> None:
        """Wait out the retry delay the phase calls for on the manager's clock; a stop or a redial cuts it short."""
        mgr = self._mgr
        await mgr.clock.pace(self._wake, reconnect_delay(mgr.phase.standing.phase))


class ConnectionManager:
    """Holds the clients, the readings and the collaborators every route and lane reaches the daemon through."""

    def __init__(self, cfg: Config, http_client: HttpConfigClient | None = None, clock: Clock | None = None) -> None:
        """Bind the configuration, the 8088 client and the clock, and build the collaborators."""
        self.cfg = cfg
        self._http = http_client
        self._retired: list[HttpConfigClient] = []
        self.clock = clock if clock is not None else Clock()
        self.readings = Readings()
        self.audit = AuditLog(cfg.debug_log, now=self.clock.now)
        self.presetops = PresetOps(cfg, self)
        self.applyops = ApplyOps(self)
        self.log_reader = LogReader(self.clock)
        self.live_writes = asyncio.Lock()
        self.metering: MeteringReader | None = None
        self.control: ControlClient | None = None
        self.phase = Lifecycle(cfg.alarm_threshold, self.clock.monotonic())
        self.changed = self.phase.changed
        self._supervisor = _Supervisor(self)

    @property
    def http_client(self) -> HttpConfigClient | None:
        """Return the 8088 client, or None when no management credentials were configured."""
        return self._http

    @http_client.setter
    def http_client(self, client: HttpConfigClient | None) -> None:
        """Attach the 8088 client built for the credentials just saved, retiring the one it replaces.

        Retired, not closed: a write lane may hold the replaced client across an await, and closing it here would
        abort that write. ``aclose`` closes every retired client, when nothing is mid-request.
        """
        if client is self._http:
            return
        if self._http is not None:
            self._retired.append(self._http)
        self._http = client

    async def run(self) -> None:
        """Keep the daemon connected until ``stop``, entering the connect loop again after a fault's retry delay."""
        await self._supervisor.run()

    def stop(self) -> None:
        """End ``run`` promptly, never waiting out an interval; a stop before ``run`` starts ends it at once."""
        self._supervisor.stop()

    async def aclose(self) -> None:
        """Stop the connect loop and close the control connection, every retired 8088 client and the log reader.

        The caller awaits ``run`` separately. The 8088 client still in service is the caller's to close.
        """
        self.stop()
        client, self.control = self.control, None
        if client is not None:
            await client.close()
        while self._retired:
            await self._retired.pop().aclose()
        await self.log_reader.aclose()

    async def retarget(self) -> None:
        """Close the connection to the old address, then dial at once to the address the config now names.

        The close is HQPTuner's own, a taken Down that leaves the generation where it stood; the readings taken on
        the old connection break with it. The redial ends ``loader.run`` at its next wait, with no client left for
        its ``finally`` to close. The connect body reads the configured address on every dial. The metering reader
        dials its own socket, so it is pointed at the configured host and metering port separately.
        """
        self.phase.report(Fact.SOCKET_CLOSED, self.clock.monotonic())
        self.readings.break_engine()
        control, self.control = self.control, None
        if control is not None:
            await control.close()
        self._supervisor.redial()
        if self.metering is not None:
            self.metering.retarget((self.cfg.hqp_host, self.cfg.hqp_metering_port))

    def require_control(self) -> ControlClient:
        """Return the connected control client, or raise when no connection stands."""
        if self.control is not None:
            return self.control
        raise ControlConnectionFailedError(host=self.cfg.hqp_host, port=self.cfg.hqp_control_port)

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 client, or raise the refusal for its absence."""
        if self._http is None:
            raise NoHttpClientError
        return self._http

    async def take_control_down(self, reason: str) -> None:
        """Close the control client, if one is held, break its readings and report the socket taken Down.

        ``reason`` is why.
        """
        del reason
        control, self.control = self.control, None
        if control is not None:
            await control.close()
        self.readings.break_engine()
        self.phase.report(Fact.SOCKET_TAKEN, self.clock.monotonic())

    async def refresh_http_forms(self) -> FormsOutcome:
        """Refresh the forms, then the device capability read for the device the config form selects.

        Answers what the forms refresh did.
        """
        refreshed = await forms.refresh(self)
        await engineread.refresh_device_caps(self)
        return refreshed.outcome
