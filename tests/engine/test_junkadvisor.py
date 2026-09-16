"""The junk verdict read off one per-bin minimum spectrum.

Every case builds a 1025-value level spectrum on a grid spanning 0 Hz to
88200.0 Hz, so bin ``i`` sits at ``i * 88200 / 1024`` Hz. Cases assert the
corner the verdict names, or ``None`` where the spectrum earns no verdict.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from hqptuner.engine import junkadvisor
from hqptuner.engine.junkadvisor import classify

if TYPE_CHECKING:
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


def _bin_hz(index: int) -> float:
    return index * BIN_HZ


def _classify(levels: Levels) -> Verdict | None:
    """The verdict a caller reading the window in front of it alone gets."""
    return classify(levels, BANDWIDTH, samplerate=SAMPLERATE, sdm=False)


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


@pytest.mark.parametrize(
    ("spectrum", "corner"),
    [
        (_ceiling_under_a_plateau(), "20k"),
        (_ceiling(-95.0, 22000.0), None),
        (_ceiling(-70.0, 20000.0), None),
    ],
    ids=["50 dB drop past a plateau", "25 dB shoulder", "ceiling at 20 kHz"],
)
def test_20k_is_earned_only_on_a_deep_drop(spectrum: Levels, corner: Corner) -> None:
    assert _corner(_classify(spectrum)) == corner


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
