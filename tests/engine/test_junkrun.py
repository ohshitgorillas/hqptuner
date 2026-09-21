"""The run rule standing between the per-block junk reading and the corner.

Blocks are built at 1025 bins on a grid spanning 0 Hz to 48000.0 Hz, read at
bandwidth 48000.0 and samplerate 96000, from frames carrying flat bands. Three
inputs are named once and used by name: ``A`` reads junk, ``B`` reads real and
``C`` is no record at all. A sequence is written as its letters, in the order
the blocks close.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from hqptuner.engine import junkrun
from hqptuner.engine.blockstats import block_record
from hqptuner.engine.junkadvisor import classify
from hqptuner.engine.metering import SpectralAggregate

if TYPE_CHECKING:
    from collections.abc import Sequence

    from hqptuner.engine.blockstats import BlockRecord

Verdict = dict[str, Any]
Band = tuple[float, float, float]
Corner = str | None
Frame = list[float]

BINS = 1025
HZ = 48000.0
RATE = 96000
BIN_HZ = HZ / (BINS - 1)
PER_HZ_OFFSET_DB = 16.7091
FLOOR_DB = -200.0

JUNK_BAND = (24300.0, 30000.0)
SUB_FOLD_BAND = (20250.0, 23700.0)
MUSIC_BAND = (15000.0, 18000.0)
FOLD_STEP_DB = 12.0


def _raw_db(per_hz_db: float) -> float:
    """The bin level a flat band takes to read at that level per Hz here."""
    return per_hz_db + PER_HZ_OFFSET_DB


def _power(level_db: float) -> float:
    return float(10.0 ** (level_db / 10.0))


def _frame(bands: Sequence[Band]) -> Frame:
    """One frame carrying each band flat at its bin level, in power."""
    frame = [_power(FLOOR_DB)] * BINS
    for low_hz, high_hz, level_db in bands:
        for index in range(BINS):
            if low_hz <= index * BIN_HZ <= high_hz:
                frame[index] = _power(level_db)
    return frame


def _junk_frame() -> Frame:
    """Input A: junk far under the music band, across a 12.0 dB fold step."""
    junk_raw_db = _raw_db(-118.0)
    junk = (*JUNK_BAND, junk_raw_db)
    below_fold = (*SUB_FOLD_BAND, junk_raw_db - FOLD_STEP_DB)
    music = (*MUSIC_BAND, _raw_db(-60.0))
    return _frame([junk, below_fold, music])


def _real_frame() -> Frame:
    """Input B: the same shape with the junk band 10 dB under the music."""
    junk = (*JUNK_BAND, -50.0)
    below_fold = (*SUB_FOLD_BAND, -62.0)
    music = (*MUSIC_BAND, -40.0)
    return _frame([junk, below_fold, music])


def _frames_of(name: str) -> Frame:
    """The frame the named input is built from."""
    return _junk_frame() if name == "A" else _real_frame()


def _record(name: str) -> BlockRecord | None:
    """The closed-block record the named input carries, or None for C."""
    if name == "C":
        return None
    return block_record([_frames_of(name)], HZ)


def _fold_after(seq: str) -> float | None:
    """The fold one fresh run stands engaged at, having observed that sequence."""
    run = junkrun.JunkRun()
    for name in seq:
        run.observe(_record(name), HZ)
    return run.engaged_fold()


def _corner(verdict: Verdict | None) -> Corner:
    """The corner a verdict names, or None where there is no verdict."""
    return None if verdict is None else str(verdict["filter"])


def _corner_after(name: str, blocks: int) -> Corner:
    """The corner a caller reads off one aggregate fed that many blocks."""
    agg = SpectralAggregate(BINS, HZ)
    for _ in range(blocks):
        agg.add(_frames_of(name), 1.0)
    mins = agg.window_min_db()
    found = classify(mins, HZ, samplerate=RATE, sdm=False, run=agg.junk_run)
    return _corner(found)


@pytest.mark.parametrize(
    ("seq", "fold"),
    [("BA", None), ("AA", 24000.0)],
    ids=["a real block then a junk one", "two junk blocks"],
)
def test_engagement_takes_two_junk_blocks(seq: str, fold: float | None) -> None:
    assert _fold_after(seq) == fold


@pytest.mark.parametrize(
    ("seq", "fold"),
    [("ACCAC", 24000.0), ("ACCCA", None)],
    ids=["a confirming block three away", "a confirming block four away"],
)
def test_confirmation_expires_after_three_blocks(seq: str, fold: float | None) -> None:
    assert _fold_after(seq) == fold


@pytest.mark.parametrize(
    ("seq", "fold"),
    [("AACCC", 24000.0), ("AACCB", None)],
    ids=["blocks carrying no record", "a block reading real"],
)
def test_an_engaged_run_stands_through_gaps(seq: str, fold: float | None) -> None:
    assert _fold_after(seq) == fold


@pytest.mark.parametrize(
    ("name", "blocks", "corner"),
    [("A", 1, None), ("A", 3, "20k"), ("B", 3, None)],
    ids=["one junk block", "three junk blocks", "three real blocks"],
)
def test_the_corner_follows_the_run(name: str, blocks: int, corner: Corner) -> None:
    assert _corner_after(name, blocks) == corner
