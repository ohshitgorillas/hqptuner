"""Write lanes -- each converts staged settings into wire operations against the daemon."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hqptuner.voltrace import VoltraceManager, VoltraceReadings

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Awaitable, Callable

    from hqptuner.conf.httpconf import HttpConfigClient
    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.engine.control import ControlClient
    from hqptuner.lanes.http.forms import FormsOutcome
    from hqptuner.lanes.live.lane import LiveMemory


class LaneClock(Protocol):
    """The reads and waits a lane paces on."""

    @property
    def monotonic(self) -> Callable[[], float]:
        """Return the monotonic read every lane deadline is taken from."""

    @property
    def sleep(self) -> Callable[[float], Awaitable[None]]:
        """Return the wait a lane sleeps between retries on."""

    @property
    def wait(self) -> Callable[[asyncio.Event, float], Awaitable[bool]]:
        """Return the wait for an event under a deadline, answering whether it was set."""


class LaneReadings(VoltraceReadings, Protocol):
    """The parts of what the daemon last told us that the lanes read and refill."""

    status: dict[str, str] | None
    enums: dict[str, list[dict[str, str]]] | None
    active_config: str | None
    live: LiveMemory
    config_form: ConfigForm | None
    config_error: str | None
    matrix_form: MatrixForm | None
    matrix_error: str | None
    speakers_form: SpeakersForm | None
    speakers_error: str | None
    credentials_ok: bool | None
    file_config: dict[str, str] | None


class LaneManager(VoltraceManager, Protocol):
    """The manager as the lanes reach the daemon through it: readings, clients, clock and connection history."""

    @property
    def readings(self) -> LaneReadings:
        """Return what the daemon last told us."""

    @property
    def clock(self) -> LaneClock:
        """Return the clock every lane wait paces on."""

    @property
    def connected(self) -> asyncio.Event:
        """Return the event set while a whole control connection stands."""

    @property
    def changed(self) -> asyncio.Event:
        """Return the event set on every edge either daemon lane reports."""

    @property
    def live_writes(self) -> asyncio.Lock:
        """Return the lock every live-setter batch holds."""

    @property
    def connects(self) -> int:
        """Return the whole connects completed since construction."""

    @property
    def drops(self) -> int:
        """Return the drops that were evidence the daemon went away."""

    @property
    def drops_at_connect(self) -> int:
        """Return ``drops`` as of the most recently completed connect."""

    @property
    def ready(self) -> bool:
        """Return whether both daemon lanes are up."""

    @property
    def alarm_threshold(self) -> float:
        """Return the unreachable-to-alarm seconds, the lanes' default deadline."""

    @property
    def control(self) -> ControlClient | None:
        """Return the live 4321 client, or None while unreachable."""

    @property
    def http_client(self) -> HttpConfigClient | None:
        """Return the 8088 config client, or None when no management credentials were configured."""

    def require_control(self) -> ControlClient:
        """Return the live 4321 client, raising ``ControlError`` while the daemon is not connected."""

    def require_http(self) -> HttpConfigClient:
        """Return the 8088 config client, raising ``ControlError`` when no credentials were configured."""

    async def refresh_http_forms(self) -> FormsOutcome:
        """Refresh the polled 8088 form snapshots and the device capability, answering what /config did."""

    async def restarting(self) -> None:
        """Drop the control lane a restore just killed and start the reconnect now."""
