"""The current stamped reading of each store, and nothing composed from them."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, TypedDict, Unpack

if TYPE_CHECKING:
    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.engine.devicecaps import DeviceCaps


class Source(Enum):
    """The store a value was read from."""

    ENGINE = "engine"
    FILE = "file"
    STAGED = "staged"


@dataclass(frozen=True)
class Stamp:
    """Where a reading came from and the lifecycle generation it was read in."""

    source: Source
    generation: int


class EngineFields(TypedDict, total=False):
    """The Engine values one reading on 4321 may carry, each optional."""

    state: dict[str, str] | None  # engine, list index
    status: dict[str, str] | None  # engine, text
    enums: dict[str, list[dict[str, str]]] | None  # engine, list index to name and enum ID
    volume_range: dict[str, str] | None  # engine, dB and flag
    matrix_profiles: list[str] | None  # engine, text
    active_config: str | None  # engine, text


ENGINE_FIELDS: tuple[str, ...] = tuple(EngineFields.__annotations__)


@dataclass(frozen=True)
class EngineSnapshot:
    """One stamped view of the Engine readings, as they stood when it was taken."""

    stamp: Stamp
    state: dict[str, str] | None = None  # engine, list index
    status: dict[str, str] | None = None  # engine, text
    enums: dict[str, list[dict[str, str]]] | None = None  # engine, list index to name and enum ID
    volume_range: dict[str, str] | None = None  # engine, dB and flag
    matrix_profiles: list[str] | None = None  # engine, text
    active_config: str | None = None  # engine, text


@dataclass
class Readings:
    """Every store's current reading, empty until a lane fills it.

    The Engine readings live until the next break: after one they read as not
    read yet until the next reading. The File readings live until the next
    write to the File and no Engine break touches them.
    """

    state: dict[str, str] | None = None  # engine, list index
    status: dict[str, str] | None = None  # engine, text
    enums: dict[str, list[dict[str, str]]] | None = None  # engine, list index to name and enum ID
    active_config: str | None = None  # engine, text
    file_config: dict[str, str] | None = None  # file, enum ID
    config_form: ConfigForm | None = None  # file, form field values
    matrix_form: MatrixForm | None = None  # file, form field values
    speakers_form: SpeakersForm | None = None  # file, form field values
    config_error: str | None = None
    matrix_error: str | None = None
    speakers_error: str | None = None
    credentials_ok: bool | None = None
    info: dict[str, str] | None = None  # engine, GetInfo attributes as text
    engine: dict[str, str] | None = None  # file, engine tag attributes as text and flag
    matrix_profiles: list[str] | None = None  # engine, text
    volume_range: dict[str, str] | None = None  # engine, dB and flag
    device_caps: DeviceCaps | None = None
    caps_device: str | None = None
    caps_at: float = 0.0
    caps_misses: int = 0
    last_volume_write: str | None = None
    engine_stamp: Stamp | None = None
    held: EngineSnapshot | None = None

    def take_engine(self, generation: int, **fields: Unpack[EngineFields]) -> None:
        """Take one Engine reading read in ``generation``; a field it does not carry keeps its reading."""
        for name, value in fields.items():
            setattr(self, name, value)
        self.engine_stamp = Stamp(source=Source.ENGINE, generation=generation)

    def engine_snapshot(self) -> EngineSnapshot | None:
        """Return the current Engine view, or ``None`` when nothing was read since the last break."""
        if self.engine_stamp is None:
            return None
        return EngineSnapshot(
            stamp=self.engine_stamp,
            state=self.state,
            status=self.status,
            enums=self.enums,
            volume_range=self.volume_range,
            matrix_profiles=self.matrix_profiles,
            active_config=self.active_config,
        )

    def break_engine(self) -> None:
        """End the Engine view at Down or an outcome, holding its last reading for the drop report."""
        snapshot = self.engine_snapshot()
        if snapshot is not None:
            self.held = snapshot
        for name in ENGINE_FIELDS:
            setattr(self, name, None)
        self.engine_stamp = None

    def take_held(self) -> EngineSnapshot | None:
        """Give up the reading held from before the last break, once."""
        held, self.held = self.held, None
        return held
