"""The manager as a lane drives it: the readings a lane reads and the collaborators it reaches."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import asyncio

    from hqptuner.audit import AuditLog
    from hqptuner.clock import Clock
    from hqptuner.conf.httpconf import HttpConfigClient
    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.config import Config
    from hqptuner.engine.control import ControlClient
    from hqptuner.engine.devicecaps import DeviceCaps
    from hqptuner.engine.logtail import LogReader
    from hqptuner.lanes.http.forms import FormsOutcome


class LaneReadings(Protocol):
    """What the daemon last told us, as a lane reads and refills it."""

    state: dict[str, str] | None
    status: dict[str, str] | None
    enums: dict[str, list[dict[str, str]]] | None
    active_config: str | None
    file_config: dict[str, str] | None
    config_form: ConfigForm | None
    matrix_form: MatrixForm | None
    speakers_form: SpeakersForm | None
    config_error: str | None
    matrix_error: str | None
    speakers_error: str | None
    credentials_ok: bool | None
    engine: dict[str, str] | None
    matrix_profiles: list[str] | None
    volume_range: dict[str, str] | None
    device_caps: DeviceCaps | None
    caps_device: str | None
    caps_at: float
    caps_misses: int
    last_volume_write: str | None


class LaneManager(Protocol):
    """The manager as a lane drives it."""

    @property
    def readings(self) -> LaneReadings:
        """Return what the daemon last told us."""

    @property
    def clock(self) -> Clock:
        """Return the clock."""

    @property
    def cfg(self) -> Config:
        """Return the configuration the manager was built from."""

    @property
    def http_client(self) -> HttpConfigClient | None:
        """Return the 8088 client, if any."""

    @http_client.setter
    def http_client(self, value: HttpConfigClient | None) -> None:
        """Replace the 8088 client."""

    @property
    def audit(self) -> AuditLog:
        """Return the event log."""

    @property
    def live_writes(self) -> asyncio.Lock:
        """Return the lock serializing live writes."""

    @property
    def log_reader(self) -> LogReader:
        """Return the daemon log reader."""

    def require_control(self) -> ControlClient:
        """Return the control client or raise."""

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 client or raise."""

    async def refresh_http_forms(self) -> FormsOutcome:
        """Refill the form snapshots."""
