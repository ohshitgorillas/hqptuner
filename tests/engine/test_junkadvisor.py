"""The junk verdict read off one per-bin minimum spectrum.

Every case builds a 1025-value level spectrum on a grid spanning 0 Hz to
88200.0 Hz, so bin ``i`` sits at ``i * 88200 / 1024`` Hz, except the cases
carrying a closed block, which span 0 Hz to 48000.0 Hz. Cases assert the
corner the verdict names, or ``None`` where the spectrum earns no verdict.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from hqptuner.engine import junkadvisor
from hqptuner.engine.blockstats import block_record
from hqptuner.engine.junkadvisor import classify, verdicts

if TYPE_CHECKING:
    from collections.abc import Sequence

    from hqptuner.engine.blockstats import BlockRecord
    from hqptuner.engine.junkadvisor import SpurHolder

Verdict = dict[str, Any]
Levels = list[float]
Corner = str | None

BINS = 1025
BANDWIDTH = 88200.0
SAMPLERATE = 176400
BIN_HZ = BANDWIDTH / (BINS - 1)

TONE_35K_BIN = 406
TONE_60K_BIN = 697

BLOCK_HZ = 48000.0
BLOCK_RATE = 96000
BLOCK_BIN_HZ = BLOCK_HZ / (BINS - 1)
PER_HZ_OFFSET_DB = 16.7091
FLOOR_DB = -200.0

Grid = tuple[float, int]
Call = tuple[Levels, Grid, "BlockRecord | None"]
Corners = tuple[str, ...]
WIDE_GRID: Grid = (BANDWIDTH, SAMPLERATE)
BLOCK_GRID: Grid = (BLOCK_HZ, BLOCK_RATE)


def _bin_hz(index: int) -> float:
    return index * BIN_HZ


def _classify(levels: Levels) -> Verdict | None:
    """The verdict a caller reading the window in front of it alone gets."""
    return classify(levels, BANDWIDTH, samplerate=SAMPLERATE, sdm=False)


def _corner_on(levels: Levels, grid: Grid, block: BlockRecord | None) -> Corner:
    """The corner a caller gets for one window, with or without a closed block."""
    hz, rate = grid
    if block is None:
        return _corner(classify(levels, hz, samplerate=rate, sdm=False))
    return _corner(classify(levels, hz, samplerate=rate, sdm=False, block=block))


def _classify_held(levels: Levels, holder: SpurHolder) -> Verdict | None:
    """The verdict a caller carrying a spur hold between windows gets."""
    return classify(levels, BANDWIDTH, samplerate=SAMPLERATE, sdm=False, holder=holder)


def _corner(verdict: Verdict | None) -> Corner:
    """The corner a verdict names, or None where there is no verdict."""
    return None if verdict is None else str(verdict["filter"])


# --- the cliff: content stopping at a ceiling -------------------------------------


def _ceiling(content_db: float, ceiling_hz: float) -> Levels:
    return [content_db if _bin_hz(i) <= ceiling_hz else -120.0 for i in range(BINS)]


PLATEAU_FIRST_BIN = 462  # 39.8 kHz
PLATEAU_LAST_BIN = 562  # 48.4 kHz


def _ceiling_under_a_plateau() -> Levels:
    """Content to 22 kHz, 50 dB over the band above it, with loud ultrasonic
    junk standing in that band."""
    levels = _ceiling(-70.0, 22000.0)
    for i in range(PLATEAU_FIRST_BIN, PLATEAU_LAST_BIN + 1):
        levels[i] = -20.0
    return levels


# --- the block: one closed second of frames behind the same window ----------------

JUNK_BAND = (24300.0, 30000.0)
MUSIC_BAND = (15000.0, 18000.0)
SUB_FOLD_BAND = (20250.0, 23700.0)
FOLD_STEP_DB = 12.0
TONE_27K_BIN = 576


def _raw_db(per_hz_db: float) -> float:
    """The bin level a flat band takes to read at that level per Hz on this grid."""
    return per_hz_db + PER_HZ_OFFSET_DB


def _band_levels(bands: Sequence[tuple[float, float, float]]) -> Levels:
    """A level spectrum on the 48 kHz grid carrying each band at its bin level."""
    levels = [FLOOR_DB] * BINS
    for low_hz, high_hz, level_db in bands:
        for index in range(BINS):
            if low_hz <= index * BLOCK_BIN_HZ <= high_hz:
                levels[index] = level_db
    return levels


def _rows(levels: Levels) -> list[list[float]]:
    """The one frame whose per-bin minimum is that spectrum."""
    return [[10.0 ** (level_db / 10.0) for level_db in levels]]


def _junk_over_music(junk_per_hz_db: float) -> Levels:
    """Ultrasonic junk over a music band held at -60 dB per Hz."""
    junk = (*JUNK_BAND, _raw_db(junk_per_hz_db))
    music = (*MUSIC_BAND, _raw_db(-60.0))
    return _band_levels([junk, music])


def _junk_over_music_across_the_fold(music_raw_db: float) -> Levels:
    """A 12.0 dB fold step held fixed while the music band alone moves."""
    junk = (*JUNK_BAND, -50.0)
    below_fold = (*SUB_FOLD_BAND, -50.0 - FOLD_STEP_DB)
    music = (*MUSIC_BAND, music_raw_db)
    return _band_levels([junk, below_fold, music])


def _bands_moving_together(junk_per_hz: float, music_per_hz: float) -> Levels:
    """A 12.0 dB fold step and a fixed junk-to-music ratio, every band moving."""
    junk_raw_db = _raw_db(junk_per_hz)
    junk = (*JUNK_BAND, junk_raw_db)
    below_fold = (*SUB_FOLD_BAND, junk_raw_db - FOLD_STEP_DB)
    music = (*MUSIC_BAND, _raw_db(music_per_hz))
    return _band_levels([junk, below_fold, music])


def _with_a_27k_tone(levels: Levels) -> Levels:
    """The same spectrum with one bin at 27 kHz standing 40 dB over its band."""
    lifted = list(levels)
    lifted[TONE_27K_BIN] += 40.0
    return lifted


def _blocked(levels: Levels) -> Call:
    """A window and the record of the block built from the very same frame."""
    return (levels, BLOCK_GRID, block_record(_rows(levels), BLOCK_HZ))


def _windowed(levels: Levels) -> Call:
    """A window with no closed block behind it."""
    return (levels, WIDE_GRID, None)


@pytest.mark.parametrize(
    ("call", "corner"),
    [
        (_windowed(_ceiling_under_a_plateau()), None),
        (_windowed(_ceiling(-95.0, 22000.0)), None),
        (_windowed(_ceiling(-70.0, 20000.0)), None),
        (_blocked(_bands_moving_together(-118.0, -60.0)), "20k"),
        (_blocked(_bands_moving_together(-132.0, -74.0)), None),
        (_blocked(_junk_over_music_across_the_fold(-30.0)), "20k"),
        (_blocked(_junk_over_music_across_the_fold(-40.0)), None),
    ],
    ids=[
        "50 dB drop past a plateau",
        "25 dB shoulder",
        "ceiling at 20 kHz",
        "junk 7 dB over the level line",
        "junk 7 dB under the level line",
        "junk 20 dB under the music",
        "junk 10 dB under the music",
    ],
)
def test_20k_is_earned_only_on_a_deep_drop(call: Call, corner: Corner) -> None:
    assert _corner_on(*call) == corner


def _verdict_corners(levels: Levels) -> Corners:
    """Every corner a caller reading one window with its closed block is offered."""
    record = block_record(_rows(levels), BLOCK_HZ)
    found = verdicts(levels, BLOCK_HZ, samplerate=BLOCK_RATE, sdm=False, block=record)
    return tuple(sorted(str(verdict["filter"]) for verdict in found))


@pytest.mark.parametrize(
    ("junk_db", "seen"),
    [(-160.0, ("30k",)), (-118.0, ("20k", "30k"))],
    ids=["a block under the level line", "a block over it"],
)
def test_a_tone_keeps_its_corner_off_the_block(junk_db: float, seen: Corners) -> None:
    assert _verdict_corners(_with_a_27k_tone(_junk_over_music(junk_db))) == seen


# --- the spur: persistent tones over their own neighbourhood ----------------------


def _with_tones(*tones: tuple[int, float]) -> Levels:
    levels = [-70.0 - 0.005 * i for i in range(BINS)]
    for index, lift_db in tones:
        levels[index] += lift_db
    return levels


@pytest.mark.parametrize(
    ("spectrum", "corner"),
    [
        (_with_tones((TONE_35K_BIN, 30.0), (TONE_60K_BIN, 40.0)), "30k"),
        (_with_tones((TONE_60K_BIN, 40.0)), "40k"),
    ],
    ids=["a quiet 35 kHz tone beside a loud 60 kHz one", "the 60 kHz tone alone"],
)
def test_the_lower_tone_sets_the_corner(spectrum: Levels, corner: Corner) -> None:
    assert _corner(_classify(spectrum)) == corner


# --- the ramp: rising ultrasonic noise --------------------------------------------

RAMP_FIRST_BIN = 668  # the first bin at or above 57500 Hz
RAMP_LAST_BIN = 999


def _steady_rise() -> Levels:
    """A 1.0 dB climb, linear across the whole ultrasonic span."""
    levels = [-100.0] * BINS
    span = RAMP_LAST_BIN - RAMP_FIRST_BIN
    for i in range(RAMP_FIRST_BIN, RAMP_LAST_BIN + 1):
        levels[i] = -100.0 + 1.0 * (i - RAMP_FIRST_BIN) / span
    return levels


def _hump() -> Levels:
    """A 9 dB climb to the middle of the span, falling back to -94.0 by its end."""
    levels = [-100.0] * BINS
    mid = (RAMP_FIRST_BIN + RAMP_LAST_BIN) // 2
    for i in range(RAMP_FIRST_BIN, mid + 1):
        levels[i] = -100.0 + 9.0 * (i - RAMP_FIRST_BIN) / (mid - RAMP_FIRST_BIN)
    for i in range(mid, RAMP_LAST_BIN + 1):
        levels[i] = -91.0 - 3.0 * (i - mid) / (RAMP_LAST_BIN - mid)
    return levels


@pytest.mark.parametrize(
    ("spectrum", "corner"),
    [
        (_steady_rise(), "50k"),
        (_hump(), None),
    ],
    ids=["a steady 1 dB rise", "a 9 dB hump falling back"],
)
def test_ramp_is_read_by_steadiness_not_size(spectrum: Levels, corner: Corner) -> None:
    assert _corner(_classify(spectrum)) == corner


# --- the hold: one holder carried across successive windows -----------------------

HOLD_WINDOWS: tuple[tuple[tuple[int, float], ...], ...] = (
    ((TONE_60K_BIN, 12.0),),
    ((TONE_60K_BIN, 40.0),),
    ((TONE_60K_BIN, 12.0),),
    ((TONE_60K_BIN, 12.0), (TONE_35K_BIN, 30.0)),
    ((TONE_60K_BIN, 12.0), (TONE_35K_BIN, 5.0)),
    ((TONE_60K_BIN, 5.0), (TONE_35K_BIN, 5.0)),
)
HOLD_CORNERS: tuple[Corner, ...] = (None, "40k", "40k", "30k", "40k", None)


def _corners_across_one_holder() -> list[Corner]:
    """The corner each window in turn reports, every call sharing one holder."""
    holder = junkadvisor.SpurHolder()
    return [_corner(_classify_held(_with_tones(*t), holder)) for t in HOLD_WINDOWS]


@pytest.mark.parametrize(
    ("window", "corner"),
    list(enumerate(HOLD_CORNERS)),
    ids=["W0", "W1", "W2", "W3", "W4", "W5"],
)
def test_a_held_spur_survives_a_sagging_window(window: int, corner: Corner) -> None:
    assert _corners_across_one_holder()[window] == corner
