"""The current stamped reading of each store, and nothing composed from them."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, TypedDict, Unpack

if TYPE_CHECKING:
    from collections.abc import Callable

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
    status_metadata: dict[str, str] | None  # engine, the Status frame's track metadata as text
    enums: dict[str, list[dict[str, str]]] | None  # engine, list index to name and enum ID
    volume_range: dict[str, str] | None  # engine, dB and flag
    matrix_profiles: list[str] | None  # engine, text
    active_config: str | None  # engine, text
    license: dict[str, str] | None  # engine, GetLicense attributes as text
    release: str | None  # engine, the installed release off the 8088 /about page as text, None until read
    info: dict[str, str] | None  # engine, GetInfo attributes as text


ENGINE_FIELDS: tuple[str, ...] = tuple(EngineFields.__annotations__)


class FileFields(TypedDict, total=False):
    """The File values one reading on 8088 may carry, each optional."""

    file_config: dict[str, str] | None  # file, enum ID
    config_form: ConfigForm | None  # file, form field values
    matrix_form: MatrixForm | None  # file, form field values
    speakers_form: SpeakersForm | None  # file, form field values
    config_error: str | None
    matrix_error: str | None
    speakers_error: str | None
    credentials_ok: bool | None
    engine: dict[str, str] | None  # file, engine tag attributes as text and flag


def _unheard() -> None:
    """Hear nothing: the change hook of readings nobody relays."""


@dataclass(frozen=True)
class EngineSnapshot:
    """One stamped view of the Engine readings, as they stood when it was taken."""

    stamp: Stamp
    state: dict[str, str] | None = None  # engine, list index
    status: dict[str, str] | None = None  # engine, text
    status_metadata: dict[str, str] | None = None  # engine, the Status frame's track metadata as text
    enums: dict[str, list[dict[str, str]]] | None = None  # engine, list index to name and enum ID
    volume_range: dict[str, str] | None = None  # engine, dB and flag
    matrix_profiles: list[str] | None = None  # engine, text
    active_config: str | None = None  # engine, text
    license: dict[str, str] | None = None  # engine, GetLicense attributes as text
    release: str | None = None  # engine, the installed release off the 8088 /about page as text, None until read
    info: dict[str, str] | None = None  # engine, GetInfo attributes as text


@dataclass
class Readings:
    """Every store's current reading, empty until a lane fills it.

    The Engine readings live until the next break: after one they read as not
    read yet until the next reading. The File readings live until the next
    write to the File and no Engine break touches them. ``on_change`` runs
    whenever a reading or a break moves the Engine view, and whenever a File
    reading moves the File readings, so whoever relays them hears of it when
    they move.
    """

    state: dict[str, str] | None = None  # engine, list index
    status: dict[str, str] | None = None  # engine, text
    status_metadata: dict[str, str] | None = None  # engine, the Status frame's track metadata as text
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
    license: dict[str, str] | None = None  # engine, GetLicense attributes as text
    release: str | None = None  # engine, the installed release off the 8088 /about page as text, None until read
    engine: dict[str, str] | None = None  # file, engine tag attributes as text and flag
    matrix_profiles: list[str] | None = None  # engine, text
    volume_range: dict[str, str] | None = None  # engine, dB and flag
    device_caps: DeviceCaps | None = None
    caps_device: str | None = None
    caps_at: float = 0.0  # the manager's monotonic clock, seconds: when the device caps were last refreshed
    caps_misses: int = 0
    last_volume_write: str | None = None
    engine_stamp: Stamp | None = None
    held: EngineSnapshot | None = None
    on_change: Callable[[], None] = field(default=_unheard, repr=False, compare=False)

    def take_engine(self, generation: int, **fields: Unpack[EngineFields]) -> None:
        """Take one Engine reading read in ``generation``; a field it does not carry keeps its reading."""
        before = self.engine_snapshot()
        for name, value in fields.items():
            setattr(self, name, value)
        self.engine_stamp = Stamp(source=Source.ENGINE, generation=generation)
        if self.engine_snapshot() != before:
            self.on_change()

    def take_file(self, **fields: Unpack[FileFields]) -> bool:
        """Take one File reading and answer whether it moved them; a field it does not carry keeps its reading."""
        moved = any(getattr(self, name) != value for name, value in fields.items())
        for name, value in fields.items():
            setattr(self, name, value)
        if moved:
            self.on_change()
        return moved

    def engine_snapshot(self) -> EngineSnapshot | None:
        """Return the current Engine view, or ``None`` when nothing was read since the last break."""
        if self.engine_stamp is None:
            return None
        return EngineSnapshot(
            stamp=self.engine_stamp,
            state=self.state,
            status=self.status,
            status_metadata=self.status_metadata,
            enums=self.enums,
            volume_range=self.volume_range,
            matrix_profiles=self.matrix_profiles,
            active_config=self.active_config,
            license=self.license,
            release=self.release,
            info=self.info,
        )

    def break_engine(self) -> None:
        """End the Engine view at Down or an outcome, holding its last reading for the drop report."""
        snapshot = self.engine_snapshot()
        if snapshot is not None:
            self.held = snapshot
        for name in ENGINE_FIELDS:
            setattr(self, name, None)
        self.engine_stamp = None
        if snapshot is not None:
            self.on_change()

    def take_held(self) -> EngineSnapshot | None:
        """Give up the reading held from before the last break, once."""
        held, self.held = self.held, None
        return held
