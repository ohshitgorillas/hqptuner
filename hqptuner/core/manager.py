"""The connection manager: the one object the app holds the daemon through."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from hqptuner.audit import AuditLog
from hqptuner.clock import Clock
from hqptuner.conf.httpauth import NoHttpClientError
from hqptuner.core.applyops import ApplyOps
from hqptuner.core.lifecycle import Lifecycle
from hqptuner.core.readings import Readings
from hqptuner.engine.controlerrors import ControlConnectionFailedError
from hqptuner.engine.logtail import LogReader
from hqptuner.lanes.http.forms import FormsOutcome
from hqptuner.presets.presetops import PresetOps

if TYPE_CHECKING:
    from hqptuner.conf.httpconf import HttpConfigClient
    from hqptuner.config import Config
    from hqptuner.engine.control import ControlClient
    from hqptuner.engine.metering import MeteringReader


class ConnectionManager:
    """Holds the clients, the readings and the collaborators; a null stub until rebuilt."""

    def __init__(self, cfg: Config, http_client: HttpConfigClient | None = None, clock: Clock | None = None) -> None:
        """Bind the configuration, the 8088 client and the clock, and build the collaborators."""
        self.cfg = cfg
        self.http_client = http_client
        self.clock = clock if clock is not None else Clock()
        self.readings = Readings()
        self.audit = AuditLog(cfg.debug_log)
        self.presetops = PresetOps(cfg, self)
        self.applyops = ApplyOps(self)
        self.log_reader = LogReader(self.clock)
        self.live_writes = asyncio.Lock()
        self.metering: MeteringReader | None = None
        self.phase = Lifecycle(cfg.alarm_threshold)
        self.changed = self.phase.changed

    async def run(self) -> None:
        """Return at once."""

    def stop(self) -> None:
        """Do nothing."""

    async def aclose(self) -> None:
        """Do nothing."""

    async def retarget(self) -> None:
        """Do nothing."""

    def require_control(self) -> ControlClient:
        """Raise: there is no control connection."""
        raise ControlConnectionFailedError(host=self.cfg.container_host_alias, port=self.cfg.hqp_control_port)

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 client, or raise the refusal for its absence."""
        if self.http_client is None:
            raise NoHttpClientError
        return self.http_client

    @staticmethod
    async def refresh_http_forms() -> FormsOutcome:
        """Return that no credentials were tried."""
        return FormsOutcome.NO_CREDENTIALS
