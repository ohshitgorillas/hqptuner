"""The 20k junk signature read per closed block, and the run over blocks that engages the corner.

One block's reading is three-state: ``DROPPED`` where the block carries nothing the rule can read, ``JUNK`` where it
carries junk standing above an image fold, ``REAL`` where it reads as music. Blocks close every
``metering.BLOCK_SECONDS``, and auto-pilot samples slower than that, so one block at the cut is too little to move the
daemon: the run rule engages on the second ``JUNK`` reading within ``GAP_BLOCKS`` of the first, holds through
``DROPPED`` readings for as long as they last, and releases on the first ``REAL`` reading
(docs/junk-filter-autopilot-resource-20k.md §3.2).

The run carries no clock and no reset of its own. The aggregate that owns it is replaced when the frame geometry
moves, which is what a sample-rate change is, and dropped when the stream breaks, so the run starts over with it.
"""

import enum
import math
from typing import NamedTuple

from hqptuner.engine import blockstats

#: The level the band above the fold must reach for the corner to have anything to remove: the lowest line that keeps
#: real music in play, and the locked line.
LEVEL_LINE_DB = -125.0
#: Ratio of that band to the 15-18 kHz music band at or above which the block is forced real: real ultrasonic content
#: tracks the music to within about 15 dB.
RATIO_VETO_DB = -15.0
#: The loud-frame step's cut, candidate G90 locked at 11 dB.
STEP_CUT_DB = 11.0
#: The step at which the veto stands down, the top of the flat range.
STEP_YIELD_DB = 14.0
#: How far apart the run's two confirming junk blocks may stand, counting every block between them.
GAP_BLOCKS = 3


class State(enum.Enum):
    """What one closed block says about junk above the fold."""

    DROPPED = "dropped"
    REAL = "real"
    JUNK = "junk"


class Reading(NamedTuple):
    """One closed block's state, and the fold its loud-frame step was read at."""

    state: State
    fold: float | None


def read_block(record: blockstats.BlockRecord | None, bandwidth: float) -> Reading:
    """Return what one closed block says: the mask, the loud-frame step against its cut, and the ratio to the music.

    A block whose band above the fold sits under the level line, has no reading at all, or closed carrying no frames
    is ``DROPPED``: it neither confirms a run nor breaks one. A step under the cut, and a step the ratio vetoes
    without reaching the yield, read ``REAL``.
    """
    if record is None or not (math.isfinite(record.above_db) and record.above_db >= LEVEL_LINE_DB):
        return Reading(State.DROPPED, None)
    step, fold = blockstats.loud_frame_step(record, len(record.minimum), bandwidth)
    if not math.isfinite(step) or step < STEP_CUT_DB:
        return Reading(State.REAL, None)
    vetoed = math.isfinite(record.ratio_db) and record.ratio_db >= RATIO_VETO_DB
    if vetoed and step < STEP_YIELD_DB:
        return Reading(State.REAL, None)
    return Reading(State.JUNK, fold)


class JunkRun:
    """The run over closed block readings that engages and releases the 20k corner.

    The caller hands it every block as it closes, in order, and reads ``engaged_fold`` for the fold behind the note.
    """

    def __init__(self) -> None:
        """Start a run with nothing pending and nothing engaged."""
        self._engaged = False
        self._pending: int | None = None
        self._fold: float | None = None

    def observe(self, record: blockstats.BlockRecord | None, bandwidth: float) -> None:
        """Take one closed block, in the order the blocks close."""
        reading = read_block(record, bandwidth)
        if self._engaged:
            self._observe_engaged(reading)
            return
        self._observe_pending(reading)

    def engaged_fold(self) -> float | None:
        """Return the fold of the run's most recent junk block in Hz, or None while nothing is engaged."""
        return self._fold if self._engaged else None

    def _observe_engaged(self, reading: Reading) -> None:
        if reading.state is State.JUNK:
            self._fold = reading.fold
        elif reading.state is State.REAL:
            self._clear()

    def _observe_pending(self, reading: Reading) -> None:
        if self._pending is None:
            self._start(reading)
            return
        self._pending += 1
        if reading.state is State.DROPPED:
            if self._pending > GAP_BLOCKS:
                self._clear()
            return
        if self._pending > GAP_BLOCKS:
            self._clear()
            self._start(reading)
            return
        if reading.state is State.JUNK:
            self._engaged, self._pending, self._fold = True, None, reading.fold
            return
        self._clear()

    def _start(self, reading: Reading) -> None:
        if reading.state is State.JUNK:
            self._pending, self._fold = 0, reading.fold

    def _clear(self) -> None:
        self._engaged, self._pending, self._fold = False, None, None
