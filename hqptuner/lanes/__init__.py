"""The manager as a lane drives it: the readings a lane reads and the collaborators it reaches."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol, TypedDict, TypeVar, Unpack

if TYPE_CHECKING:
    import asyncio
    from enum import Enum

    from hqptuner.audit import AuditLog
    from hqptuner.clock import Clock
    from hqptuner.conf.httpconf import HttpConfigClient
    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.config import Config
    from hqptuner.engine.control import ControlClient
    from hqptuner.engine.devicecaps import DeviceCaps
    from hqptuner.engine.logtail import LogReader
    from hqptuner.lanes.http.forms import FormsOutcome


class LaneEngineFields(TypedDict, total=False):
    """The Engine values one reading on 4321 may carry, each optional."""

    state: dict[str, str] | None
    status: dict[str, str] | None
    status_metadata: dict[str, str] | None
    enums: dict[str, list[dict[str, str]]] | None
    volume_range: dict[str, str] | None
    matrix_profiles: list[str] | None
    active_config: str | None
    license: dict[str, str] | None
    release: str | None
    info: dict[str, str] | None


class LaneFileFields(TypedDict, total=False):
    """The File values one reading on 8088 may carry, each optional."""

    file_config: dict[str, str] | None
    config_form: ConfigForm | None
    matrix_form: MatrixForm | None
    speakers_form: SpeakersForm | None
    config_error: str | None
    matrix_error: str | None
    speakers_error: str | None
    credentials_ok: bool | None
    engine: dict[str, str] | None


class LaneStamp(Protocol):
    """A restart request's stamp: the generation it was accepted in and when."""

    @property
    def generation(self) -> int:
        """Return the generation the request was accepted in."""

    @property
    def at(self) -> float:
        """Return the clock reading at which the request was accepted."""


class LaneEngineStamp(Protocol):
    """Where an Engine reading was taken."""

    @property
    def generation(self) -> int:
        """Return the generation the reading was taken in."""


class LaneEngineSnapshot(Protocol):
    """One stamped view of the Engine readings."""

    @property
    def stamp(self) -> LaneEngineStamp:
        """Return where the view was taken."""

    @property
    def state(self) -> dict[str, str] | None:
        """Return the state reading."""

    @property
    def status(self) -> dict[str, str] | None:
        """Return the status reading."""

    @property
    def enums(self) -> dict[str, list[dict[str, str]]] | None:
        """Return the enumerations reading."""

    @property
    def volume_range(self) -> dict[str, str] | None:
        """Return the volume range reading."""

    @property
    def matrix_profiles(self) -> list[str] | None:
        """Return the matrix profiles reading."""

    @property
    def active_config(self) -> str | None:
        """Return the active configuration reading."""


class LaneStanding(Protocol):
    """The connection's standing as a lane reads it."""

    @property
    def phase(self) -> Enum:
        """Return the phase the connection is in."""

    @property
    def generation(self) -> int:
        """Return the connection's generation."""


_Stamp = TypeVar("_Stamp", bound=LaneStamp)


class LanePhase(Protocol[_Stamp]):
    """The phase holder as a lane drives it, over the one stamp type it hands out and takes back."""

    changed: asyncio.Event

    @property
    def standing(self) -> LaneStanding:
        """Return the connection's standing."""

    def request_accepted(self, now: float) -> _Stamp:
        """Stamp a restart request accepted at ``now``."""

    def readback_confirmed(self, now: float) -> None:
        """Report that a write's readback confirmed at ``now``."""

    async def until_ready(self, *, after: _Stamp, clock: Clock, deadline: float | None = None) -> bool:
        """Wait for Ready in a generation later than ``after``'s; answer whether it came in time."""


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

    def take_engine(self, generation: int, **fields: Unpack[LaneEngineFields]) -> None:
        """Take one Engine reading read in ``generation``."""

    def take_file(self, **fields: Unpack[LaneFileFields]) -> bool:
        """Take one File reading and answer whether it moved them."""

    def engine_snapshot(self) -> LaneEngineSnapshot | None:
        """Return the current Engine view, or ``None`` when nothing was read since the last break."""

    def break_engine(self) -> None:
        """End the Engine view, holding its last reading for the drop report."""

    def take_held(self) -> LaneEngineSnapshot | None:
        """Give up the reading held from before the last break, once."""


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
    def phase(self) -> LanePhase[Any]:
        """Return the phase holder."""

    @property
    def changed(self) -> asyncio.Event:
        """Return the phase holder's wake event."""

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

    async def take_control_down(self, reason: str) -> None:
        """Close the control socket ahead of a restart the daemon accepted, and report it taken Down."""

    async def refresh_http_forms(self) -> FormsOutcome:
        """Refill the form snapshots."""
