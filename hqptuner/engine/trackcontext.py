"""What is playing and through which filters, as the daemon last reported it over 4321."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from hqptuner.engine.chainfamily import SDM, status_chain

PLAYING = 2


class _Readings(Protocol):
    """The snapshots the context reads: ``State``, ``Status`` and the enumerations, as the control client parses."""

    @property
    def state(self) -> dict[str, str] | None: ...

    @property
    def status(self) -> dict[str, str] | None: ...

    @property
    def enums(self) -> dict[str, list[dict[str, str]]] | None: ...


class _HoldsReadings(Protocol):
    """Anything holding the daemon's latest readings."""

    @property
    def readings(self) -> _Readings: ...


@dataclass(frozen=True)
class TrackContext:
    """The playback facts a filter decision reads."""

    filter: str | None
    junk_filter: str | None
    samplerate: int | None
    sdm: bool
    playing: bool


def _int(value: str | None) -> int | None:
    """Return the attribute as an int, or None when it is absent or not a whole number."""
    return int(value) if value is not None and value.isdigit() else None


def _name_at(items: list[dict[str, str]], index: str | None) -> str | None:
    """Return the name the enumeration lists at this list index, or None when it lists none there."""
    if index is None:
        return None
    for item in items:
        if item.get("index") == index:
            return item.get("name")
    return None


def _rate(status: dict[str, str]) -> int | None:
    """Return the output rate in Hz, or None when Status reports none."""
    return _int(status.get("active_rate")) or None


def context_from(mgr: _HoldsReadings) -> TrackContext | None:
    """Return the track context, or None when no State reading is held."""
    readings = mgr.readings
    state = readings.state
    if state is None:
        return None
    status = readings.status or {}
    junk_filters = (readings.enums or {}).get("junk_filters", [])
    return TrackContext(
        filter=status.get("active_filter"),
        junk_filter=_name_at(junk_filters, state.get("filter_junk")),
        samplerate=_rate(status),
        sdm=status_chain(status) == SDM,
        playing=_int(state.get("state")) == PLAYING,
    )
