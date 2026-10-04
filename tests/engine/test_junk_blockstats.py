"""Per-block spectral statistics: minimum and p90 curves, fold-relative levels."""

import math
from collections.abc import Sequence

import pytest

from hqptuner.engine.blockstats import BlockRecord, block_record
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


#: What ``_latest_above`` reads where no block record stands: a behavior here (a silent block clears the
#: reading), not a broken fixture, so it is a value of its own rather than None.
NO_BLOCK = "no block record"


def _latest_above(aggregate: SpectralAggregate) -> float | str:
    """The closed block's level above the fold, or ``NO_BLOCK`` where no block record stands."""
    record = aggregate.latest_block()
    return NO_BLOCK if record is None else round(record.above_db, 1)


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


def _half_loud_half_quiet_record() -> BlockRecord:
    """One block whose bin 200 sits at -20 dB for half its frames and -90 dB for the other half."""
    loud = _spike_frame(200, -20.0)
    quiet = _spike_frame(200, -90.0)
    return block_record([loud] * 5 + [quiet] * 5, 48000.0)


def test_minimum_reads_a_bins_quietest_level() -> None:
    assert _half_loud_half_quiet_record().minimum[200] == pytest.approx(-90.0, abs=0.5)


def test_p90_reads_a_bins_loud_level() -> None:
    assert _half_loud_half_quiet_record().p90[200] == pytest.approx(-20.0, abs=0.5)


#: One added frame: the seconds it covers, and whether it is silent (a silent frame carries the silent spectrum).
Step = tuple[float, bool]


@pytest.mark.parametrize(
    ("steps", "expected"),
    [
        ([(1.0, False)], -66.7),
        ([(1.0, False), (1.0, True)], NO_BLOCK),
        ([(0.5, False), (0.5, True)], -66.7),
    ],
    ids=["one loud second", "a loud second then a silent one", "half a loud second then half a silent one"],
)
def test_block_closes_at_one_second_of_coverage(steps: list[Step], expected: float | str) -> None:
    aggregate = SpectralAggregate(BINS, 48000.0)
    for seconds, silent in steps:
        aggregate.add(_silent_frame() if silent else _junk_frame(), seconds, silent=silent)

    assert _latest_above(aggregate) == expected


def test_fold_the_grid_cannot_reach_carries_no_above_fold_level() -> None:
    rows = [_frame(24000.0, [(0.0, 24000.0, -40.0)])]

    assert math.isnan(block_record(rows, 24000.0).above_db)


def test_music_level_is_its_own_reading_of_the_music_band() -> None:
    quiet_music = block_record(_two_band_rows(-35.0), 48000.0).music_db
    loud_music = block_record(_two_band_rows(-25.0), 48000.0).music_db

    assert quiet_music - loud_music == pytest.approx(-10.0, abs=0.5)
