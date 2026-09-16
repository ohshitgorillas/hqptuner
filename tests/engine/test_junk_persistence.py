"""Spur persistence: the windowed per-bin minimum spectrum and the verdict read
off it.

`SpectralAggregate` cases feed linear per-bin powers straight into the public
`add` and read the contract back through `window_min_db` — a level of L dB is a
power of ``10 ** (L / 10)``.

Silence (spec behavior 12/17) is covered by the aggregate-level cases, which
exercise ``silent=True`` directly."""

import pytest

from hqptuner.engine.metering import BLOCK_SECONDS, WINDOW_BLOCKS, SpectralAggregate

# --- SpectralAggregate: the windowed minimum -------------------------------------

AGG_BINS = 8
_CONSTANT_BIN = 2  # fed the same power in every non-silent frame
_VARYING_BIN = 5  # fed high power in some frames, low in others


def _power(level_db: float) -> float:
    return float(10 ** (level_db / 10))


def _agg_frame(varying_db: float) -> list[float]:
    mags = [_power(-120.0)] * AGG_BINS
    mags[_CONSTANT_BIN] = _power(-20.0)
    mags[_VARYING_BIN] = _power(varying_db)
    return mags


HIGH_FRAME = _agg_frame(-20.0)
LOW_FRAME = _agg_frame(-90.0)
SILENT_FRAME = [_power(-120.0)] * AGG_BINS  # all-floor: what a silent hop carries


def test_window_min_appears_once_the_window_is_earned() -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(WINDOW_BLOCKS):  # exactly the 30 s window, to the block
        aggregate.add(HIGH_FRAME, BLOCK_SECONDS)
    assert (aggregate.window_min_db() or [])[_CONSTANT_BIN] == pytest.approx(-20.0, abs=0.5)


def _earned_alternating() -> SpectralAggregate:
    """High and low frames alternating, a full block of coverage apiece, well
    past the persistence window."""
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(WINDOW_BLOCKS + 1):
        aggregate.add(HIGH_FRAME, BLOCK_SECONDS)
        aggregate.add(LOW_FRAME, BLOCK_SECONDS)
    return aggregate


def test_a_bin_fed_the_same_power_reports_that_level() -> None:
    assert (_earned_alternating().window_min_db() or [])[_CONSTANT_BIN] == pytest.approx(-20.0, abs=0.5)


def test_an_intermittent_bin_reports_its_low_level() -> None:
    assert (_earned_alternating().window_min_db() or [])[_VARYING_BIN] == pytest.approx(-90.0, abs=0.5)


# --- SpectralAggregate: silent frames ---------------------------------------------


def _tone_plus_silence() -> SpectralAggregate:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    aggregate.add(HIGH_FRAME, 5.0)
    aggregate.add(SILENT_FRAME, 5.0, silent=True)
    return aggregate


def test_silent_frames_count_toward_frames() -> None:
    assert _tone_plus_silence().frames == 2


def test_silent_frames_count_toward_seconds() -> None:
    assert _tone_plus_silence().seconds == pytest.approx(10.0)


def test_silent_frames_never_lower_the_window_min() -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(WINDOW_BLOCKS + 1):  # tone coverage alone earns the window
        aggregate.add(HIGH_FRAME, BLOCK_SECONDS)
        aggregate.add(SILENT_FRAME, BLOCK_SECONDS, silent=True)
    assert (aggregate.window_min_db() or [])[_CONSTANT_BIN] == pytest.approx(-20.0, abs=0.5)
