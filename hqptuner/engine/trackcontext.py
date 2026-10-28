"""What is playing and through which filters, as the daemon last reported it over 4321."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from hqptuner.engine.view import EngineReading, EngineView
from hqptuner.fields import query

PLAYING = 2


class _Readings(EngineReading, Protocol):
    """The engine reading plus the track metadata ``Status`` carries."""

    @property
    def status_metadata(self) -> dict[str, str] | None: ...


class _HoldsReadings(Protocol):
    """Anything holding the daemon's latest readings."""

    @property
    def readings(self) -> _Readings: ...


@dataclass(frozen=True)
class TrackContext:
    """The playback facts a filter decision reads, ``samplerate`` and ``sdm`` describing the source track."""

    filter: str | None
    junk_filter: str | None
    samplerate: int | None
    sdm: bool
    playing: bool


def _int(value: str | None) -> int | None:
    """Return the attribute as an int, or None when it is absent or not a whole number."""
    return int(value) if value is not None and value.isdigit() else None


def context_from(mgr: _HoldsReadings) -> TrackContext | None:
    """Return the track context, or None when no State reading is held."""
    readings = mgr.readings
    state = readings.state
    if state is None:
        return None
    status = readings.status or {}
    meta = readings.status_metadata or {}
    junk = query.live("junk_filter")
    junk_index = state.get(junk.state)
    junk_name = (
        None
        if junk_index is None or junk.enumeration is None
        else EngineView.of(readings).name_at(junk.enumeration, junk_index)
    )
    return TrackContext(
        filter=status.get("active_filter"),
        junk_filter=junk_name,
        samplerate=_int(meta.get("samplerate")),
        sdm=meta.get("sdm") in ("1", "true"),
        playing=_int(state.get("state")) == PLAYING,
    )
