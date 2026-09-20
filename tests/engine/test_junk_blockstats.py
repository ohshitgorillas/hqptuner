"""Per-block spectral statistics: minimum and p90 curves, fold-relative levels."""

import math
from collections.abc import Sequence

import pytest

from hqptuner.engine.blockstats import block_record
from hqptuner.engine.metering import SpectralAggregate

BINS = 1025
FLOOR_DB = -200.0

Band = tuple[float, float, float]


def _power(level_db: float) -> float:
    return float(10.0 ** (level_db / 10.0))


def _frame(bandwidth: float, bands: Sequence[Band]) -> list[float]:
    step = bandwidth / (BINS - 1)
    frame = [_power(FLOOR_DB)] * BINS
    for low_hz, high_hz, level_db in bands:
        for index in range(BINS):
            if low_hz <= index * step <= high_hz:
                frame[index] = _power(level_db)
    return frame


def _spike_frame(index: int, level_db: float) -> list[float]:
    frame = [_power(FLOOR_DB)] * BINS
    frame[index] = _power(level_db)
    return frame


def _two_band_rows(music_db: float) -> list[list[float]]:
    junk: Band = (24300.0, 30000.0, -40.0)
    music: Band = (15000.0, 18000.0, music_db)
    return [_frame(48000.0, [junk, music])]


def _junk_frame() -> list[float]:
    return _frame(48000.0, [(24300.0, 30000.0, -50.0)])


def _silent_frame() -> list[float]:
    return _frame(48000.0, [])


def _latest_above(aggregate: SpectralAggregate) -> float | None:
    """The closed block's level above the fold, or None where no block stands."""
    record = aggregate.latest_block()
    return None if record is None else round(record.above_db, 1)


def test_above_fold_level_follows_the_fold_carrying_the_loud_band() -> None:
    block_a = [_frame(48000.0, [(28100.0, 29900.0, -40.0)])]
    block_b = [_frame(48000.0, [(22400.0, 24250.0, -60.0)])]

    above_a = block_record(block_a, 48000.0).above_db
    above_b = block_record(block_b, 48000.0).above_db

    assert above_a - above_b == pytest.approx(20.0, abs=0.5)


@pytest.mark.parametrize(
    ("music_db", "expected"),
    [(-25.0, -15.0), (-35.0, -5.0)],
)
def test_ratio_is_per_hz_not_per_band(music_db: float, expected: float) -> None:
    record = block_record(_two_band_rows(music_db), 48000.0)

    assert record.ratio_db == pytest.approx(expected, abs=0.5)


def test_minimum_and_p90_read_the_same_bin_differently() -> None:
    loud = _spike_frame(200, -20.0)
    quiet = _spike_frame(200, -90.0)

    record = block_record([loud] * 5 + [quiet] * 5, 48000.0)
    curves = (record.minimum[200], record.p90[200])

    assert curves == pytest.approx((-90.0, -20.0), abs=0.5)


def test_block_closes_at_one_second_of_coverage() -> None:
    aggregate = SpectralAggregate(BINS, 48000.0)

    aggregate.add(_junk_frame(), 1.0)
    after_loud = _latest_above(aggregate)
    aggregate.add(_silent_frame(), 1.0, silent=True)
    after_silence = _latest_above(aggregate)
    aggregate.add(_junk_frame(), 0.5)
    aggregate.add(_silent_frame(), 0.5, silent=True)
    after_half_loud = _latest_above(aggregate)

    assert (after_loud, after_silence, after_half_loud) == (-66.7, None, -66.7)


def test_fold_the_grid_cannot_reach_carries_no_above_fold_level() -> None:
    rows = [_frame(24000.0, [(0.0, 24000.0, -40.0)])]

    assert math.isnan(block_record(rows, 24000.0).above_db)


def test_music_level_is_its_own_reading_of_the_music_band() -> None:
    quiet_music = block_record(_two_band_rows(-35.0), 48000.0).music_db
    loud_music = block_record(_two_band_rows(-25.0), 48000.0).music_db

    assert quiet_music - loud_music == pytest.approx(-10.0, abs=0.5)
