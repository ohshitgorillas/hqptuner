"""One Engine reading and every join, chain decision and list check over it."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import Enum, auto
from functools import cache
from typing import Protocol, Self

from hqptuner.fields import query
from hqptuner.fields.chain import chain_name, status_chain
from hqptuner.fields.model import Chain, Decimal, Domain, Enumeration, Field, Flag, Join, Live

_AUTO = "auto"
_SOURCE = "[source]"


class EngineReading(Protocol):
    """What the Engine last answered: State, Status, the enumerations and the matrix profiles."""

    @property
    def state(self) -> Mapping[str, str] | None:
        """State's attributes, list indexes for the enumerated fields."""
        ...

    @property
    def status(self) -> Mapping[str, str] | None:
        """Status's attributes, as text."""
        ...

    @property
    def enums(self) -> Mapping[str, Sequence[Mapping[str, str]]] | None:
        """Each enumeration's items, keyed by enumeration."""
        ...

    @property
    def matrix_profiles(self) -> Sequence[str] | None:
        """The matrix profile names the Engine lists."""
        ...


@dataclass(frozen=True)
class Reading:
    """One field read from State: its form value and the name its enumeration gives it."""

    value: str
    name: str | None


class Cause(Enum):
    """Why a value does not resolve to a live index."""

    NOT_FLAG = auto()
    NOT_DECIMAL = auto()
    NOT_LISTED = auto()
    OFF_CHAIN = auto()
    NOT_LIVE = auto()
    NOT_MODE = auto()
    PROFILE_UNLISTED = auto()


@dataclass(frozen=True)
class Refusal:
    """A value refused for one field, with its cause."""

    field: str
    value: str
    cause: Cause
    enumeration: Enumeration | None = None
    chain: Chain | None = None


def _mode_value(name: str) -> str | None:
    """Return the mode form value a modes item's name denotes, case ignored, none for an unknown name."""
    if name.casefold().startswith(_SOURCE):
        return _AUTO
    return chain_name(name)


#: How each join reads an item's form value.
_FORM_VALUE: Mapping[Join, Callable[[Mapping[str, str]], str | None]] = {
    Join.ENUM_ID: lambda item: item.get("value"),
    Join.MODE_NAME: lambda item: _mode_value(item.get("name", "")),
    Join.INDEX: lambda item: item.get("index"),
    Join.HZ: lambda item: item.get("rate"),
}


@cache
def _mode_live() -> Live:
    """Return the live facts of the field the register joins by mode name."""
    rows = (query.field(name) for name in query.live_controls())
    lives = (row.live for row in rows if row is not None and row.live is not None)
    return next(live for live in lives if live.join is Join.MODE_NAME)


def is_mode(field: str) -> bool:
    """Whether ``field`` is the one the register joins by mode name."""
    row = query.field(field)
    return row is not None and row.live is not None and row.live == _mode_live()


def _live_row(field: str) -> Field | None:
    """Return the row of ``field``, none when the live lane does not take it."""
    row = query.field(field)
    if row is None or row.live is None or not (row.live_control or row.snapshot):
        return None
    return row


@dataclass(frozen=True)
class EngineView:
    """One Engine reading, asked every join over it."""

    state: Mapping[str, str] | None
    status: Mapping[str, str] | None
    enums: Mapping[str, Sequence[Mapping[str, str]]] | None
    matrix_profiles: Sequence[str] | None

    @classmethod
    def of(cls, reading: EngineReading) -> Self:
        """Build the view of ``reading``."""
        return cls(
            state=reading.state,
            status=reading.status,
            enums=reading.enums,
            matrix_profiles=reading.matrix_profiles,
        )

    def configured_chain(self) -> Chain | None:
        """Return the chain State's mode configures, none for ``auto``."""
        mode = self.mode()
        return None if mode is None or mode == _AUTO else Chain(mode)

    def loaded_chain(self) -> Chain | None:
        """Return the chain the filters and shapers belong to."""
        configured = self.configured_chain()
        if configured is not None:
            return configured
        running = status_chain(dict(self.status or {}))
        return None if running is None else Chain(running)

    def mode(self) -> str | None:
        """Return the running mode as its form value."""
        live = _mode_live()
        index = (self.state or {}).get(live.state)
        return None if index is None else self._value_at(live, index)

    def index_of(self, field: str, value: str) -> str | None:
        """Return the list index ``value`` of ``field`` joins to, on the loaded chain only."""
        row = query.field(field)
        live = None if row is None else row.live
        if live is None or live.enumeration is None or live.join is None or not self._on_chain(live):
            return None
        form_value = _FORM_VALUE[live.join]
        return next((item.get("index") for item in self._items(live.enumeration) if form_value(item) == value), None)

    def value_at(self, field: str, index: str) -> str | None:
        """Return the form value of ``field`` at list index ``index``."""
        row = query.field(field)
        return None if row is None or row.live is None else self._value_at(row.live, index)

    def name_at(self, enumeration: Enumeration, index: str) -> str | None:
        """Return the name ``enumeration`` gives the item at ``index``."""
        item = self._item_at(enumeration, index)
        return None if item is None else item.get("name")

    def index_named(self, enumeration: Enumeration, name: str) -> str | None:
        """Return the index of the item in ``enumeration`` named ``name``."""
        return next((item.get("index") for item in self._items(enumeration) if item.get("name") == name), None)

    def read(self, field: str) -> Reading | None:
        """Return ``field`` as State holds it, none off its chain or unread."""
        row = query.field(field)
        live = None if row is None else row.live
        raw = None if live is None else (self.state or {}).get(live.state)
        if live is None or raw is None:
            return None
        if live.enumeration is None:
            return Reading(raw, raw)
        value = self._value_at(live, raw)
        if value is None:
            return None
        return Reading(value, self.name_at(live.enumeration, raw) or value)

    def resolve(self, field: str, value: str) -> str | Refusal:
        """Return the live index ``value`` of ``field`` writes as, or why it cannot."""
        row = _live_row(field)
        live = None if row is None else row.live
        if row is None or live is None:
            return Refusal(field, value, Cause.NOT_LIVE)
        if live.join is Join.PROFILE_NAME:
            return value if self.profile_listed(value) else Refusal(field, value, Cause.PROFILE_UNLISTED)
        if live.enumeration is None:
            return _unenumerated(row, value)
        if not self._on_chain(live):
            return Refusal(field, value, Cause.OFF_CHAIN, chain=live.chain)
        index = self.index_of(field, value)
        return Refusal(field, value, Cause.NOT_LISTED, enumeration=live.enumeration) if index is None else index

    def profile_listed(self, name: str) -> bool:
        """Tell whether the Engine lists matrix profile ``name``; ``""`` is the default and always listed."""
        return name == "" or name in (self.matrix_profiles or ())

    def _items(self, enumeration: Enumeration) -> Sequence[Mapping[str, str]]:
        """Return the items of ``enumeration``, none when unread."""
        return (self.enums or {}).get(enumeration, ())

    def _item_at(self, enumeration: Enumeration, index: str) -> Mapping[str, str] | None:
        """Return the item of ``enumeration`` at list index ``index``."""
        return next((item for item in self._items(enumeration) if item.get("index") == index), None)

    def _on_chain(self, live: Live) -> bool:
        """Tell whether a field with ``live`` facts has an Engine value on the loaded chain."""
        return live.chain is None or live.chain == self.loaded_chain()

    def _value_at(self, live: Live, index: str) -> str | None:
        """Return the form value at list index ``index`` of a field with ``live`` facts, on its chain only."""
        if live.enumeration is None or live.join is None or not self._on_chain(live):
            return None
        item = self._item_at(live.enumeration, index)
        return None if item is None else _FORM_VALUE[live.join](item)


def _unenumerated(row: Field, value: str) -> str | Refusal:
    """Return the value a field with no enumeration writes as, or the refusal of its domain."""
    refused = out_of_domain(row, value)
    return value if refused is None else refused


#: The cause a value is refused with when its field's domain rejects it, by domain type.
_DOMAIN_CAUSE: Mapping[type[Domain], Cause] = {Flag: Cause.NOT_FLAG, Decimal: Cause.NOT_DECIMAL}


def out_of_domain(row: Field, value: str) -> Refusal | None:
    """Return the refusal of ``value`` by ``row``'s domain, or None when the domain accepts it.

    Raise KeyError when the domain rejects ``value`` and no cause is worded for its type.
    """
    if row.domain.accepts(value):
        return None
    return Refusal(row.name, value, _DOMAIN_CAUSE[type(row.domain)])


#: The wording of each cause; owner copy.
_WORDING: Mapping[Cause, str] = {
    Cause.NOT_FLAG: "{value!r} is not a 0/1 flag",
    Cause.NOT_DECIMAL: "could not convert string to float: {value!r}",
    Cause.NOT_LISTED: "{value} is not in the engine's live {enumeration} list",
    Cause.OFF_CHAIN: "belongs to the {chain} chain, which the engine has not loaded",
    Cause.NOT_LIVE: "not a live setting",
    Cause.NOT_MODE: "{value!r} is not pcm or sdm",
    Cause.PROFILE_UNLISTED: "{value!r} is not a matrix profile the engine lists",
}


def says(refusal: Refusal) -> str:
    """Return the wording of ``refusal``."""
    return _WORDING[refusal.cause].format(value=refusal.value, enumeration=refusal.enumeration, chain=refusal.chain)
