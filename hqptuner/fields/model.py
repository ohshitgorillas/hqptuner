"""What a register row is: a field, where the File keeps it, its live setter and the domain of its values."""

import re
from dataclasses import dataclass
from enum import Enum, StrEnum, auto
from typing import Protocol, override


class Chain(StrEnum):
    """The engine's two processing chains."""

    PCM = "pcm"
    SDM = "sdm"


class Enumeration(StrEnum):
    """The five lists the Engine answers on 4321."""

    MODES = "modes"
    FILTERS = "filters"
    SHAPERS = "shapers"
    RATES = "rates"
    JUNK_FILTERS = "junk_filters"


class Join(Enum):
    """Which item attribute a field's form value matches, or the matrix profile name it is."""

    ENUM_ID = auto()
    MODE_NAME = auto()
    INDEX = auto()
    HZ = auto()
    PROFILE_NAME = auto()


class Carry(Enum):
    """What carries a live value across a restart; a File field is carried by the File."""

    REALIZED = auto()
    AUTOPILOT = auto()
    NOTHING = auto()


@dataclass(frozen=True)
class Attr:
    """One attribute of a single-instance element of the config XML."""

    tag: str
    attr: str


@dataclass(frozen=True)
class Plugin:
    """One attribute of the ``<plugin type=…>`` of that type under ``<post_process>``."""

    type: str
    attr: str


class Codec(StrEnum):
    """A File location kept by a codec rather than at one attribute."""

    NET_DEVICE = "net_device"
    FIXED_ENABLED = "fixed_enabled"
    FIXED_LEVEL = "fixed_level"
    PIPELINES = "pipelines"
    PROFILES = "profiles"
    PROFILE_SAVE = "profile_save"
    PROFILE_DELETE = "profile_delete"


@dataclass(frozen=True)
class EngineAttr:
    """One ``<engine>`` attribute, written by the engine-attribute path."""

    attr: str


type Location = Attr | Plugin | Codec | EngineAttr

_INTEGER = re.compile(r"-?[0-9]+")
# surrounding whitespace, an optional sign, digits with an optional fraction or a bare fraction, an optional exponent
_DECIMAL = re.compile(r"\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*")


class Domain(Protocol):
    """The static domain of a field's values."""

    def accepts(self, value: str) -> bool:
        """Whether ``value`` is in the domain."""
        ...


@dataclass(frozen=True)
class Flag(Domain):
    """The two strings ``0`` and ``1``."""

    @override
    def accepts(self, value: str) -> bool:
        """Whether ``value`` is ``0`` or ``1``."""
        return value in ("0", "1")


@dataclass(frozen=True)
class Choice(Domain):
    """One of a fixed set of strings."""

    values: tuple[str, ...]

    @override
    def accepts(self, value: str) -> bool:
        """Whether ``value`` is one of ``values``."""
        return value in self.values


@dataclass(frozen=True)
class Integer(Domain):
    """An optional leading ``-`` and then digits."""

    @override
    def accepts(self, value: str) -> bool:
        """Whether ``value`` is an integer."""
        return _INTEGER.fullmatch(value) is not None


@dataclass(frozen=True)
class Decimal(Domain):
    """A decimal number, as the volume control sends it."""

    @override
    def accepts(self, value: str) -> bool:
        """Whether ``value`` is a decimal number."""
        return _DECIMAL.fullmatch(value) is not None


@dataclass(frozen=True)
class Text(Domain):
    """Any string; the domain of every field whose value is not checked."""

    @override
    def accepts(self, value: str) -> bool:
        """Whether ``value`` is text."""
        return True


@dataclass(frozen=True, kw_only=True)
class Setter:
    """One Control API setter, by the setting key a live batch writes it under."""

    key: str
    command: str
    stageable: bool
    tolerance: float | None  # a numeric readback matches within this; None means an exact State match
    value_fills: bool  # an argument the edit omits reads back as the edit's value


@dataclass(frozen=True, kw_only=True)
class Live:
    """How a field is written and read on the Engine."""

    setter: str
    arg: str
    state: str
    enumeration: Enumeration | None
    join: Join | None
    chain: Chain | None


@dataclass(frozen=True, kw_only=True)
class Field:
    """One setting and every fact the register holds about it."""

    name: str
    location: Location | None
    domain: Domain
    live: Live | None
    staged_route: bool
    live_control: bool
    snapshot: bool
    carry: Carry | None
    forced: str | None
    lossy_form: bool
    volume_traced: bool
