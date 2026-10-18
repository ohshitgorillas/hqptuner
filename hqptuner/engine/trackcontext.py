"""What is playing and through which filters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

PLAYING = 2


@dataclass(frozen=True)
class TrackContext:
    """The playback facts a filter decision reads."""

    filter: str | None
    junk_filter: str | None
    samplerate: int | None
    sdm: bool
    playing: bool


def context_from(mgr: LaneManager) -> TrackContext | None:
    """Return the track context, or None when nothing is known."""
    del mgr
    return None
