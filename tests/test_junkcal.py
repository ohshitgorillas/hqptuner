"""The junk-calibration capture: what each tick's row-or-not decision reduces to, and what the files hold.

Each capture case runs a real manager on the fake control daemon and a real metering reader on the fake 4322 stream,
with the capture directory under ``tmp_path``. The manager's virtual clock stamps every row with one instant, so
two files opened in a period's first second claim the same name stem. Characterization of behavior that existed
before these tests (docs/testing.md rule 8), so no red run against pre-change code applies.

Also covers ``scripts/junkcal/junkcal_view.band_stats``, the offline capture-file
reader's per-band statistics producer (its own module docstring): a row whose
stored curve rises linearly by 10 dB per 1000 Hz, so ``argmax_hz`` and
``slope_db_per_khz`` have an exact, hand-checkable answer.

Policy: docs/testing.md — one condition per test, public API only.
"""

import argparse
import math
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from apps import advanced, settled
from conftest import LiveManager
from junkcal_rig import PLAYING, Rig, block_directory, frame, metadata, rows_by_file, unblock_directory
from junkcal_view import Row, band_stats

from hqptuner.core import junkcal
from hqptuner.core.junkcal import tick_state

#: Three points rising 10 dB per 1000 Hz — a linear ramp with a known least-squares slope. The
#: band covers every point, so ``band_stats`` never takes its ``None`` (empty-band) leg.
_RISING_CURVE_ROW = Row(index=0, source="fixture", line=1, data={"spectrum": [[1000, -80], [2000, -70], [3000, -60]]})
_OPTS = argparse.Namespace(smooth=1, baseline_bins=1, above=0.0)


def test_tick_state_is_ineligible_for_a_rate_under_the_floor() -> None:
    assert tick_state(44_100, 30_000.0, 200, sdm=False) is junkcal.TickState.INELIGIBLE


def test_band_stats_argmax_hz_is_the_frequency_of_the_bands_highest_level() -> None:
    stats = band_stats(_RISING_CURVE_ROW, (0.0, 10_000.0), _OPTS)
    assert stats is not None
    assert stats.argmax_hz == 3000.0


def test_band_stats_slope_db_per_khz_is_the_bands_least_squares_slope() -> None:
    stats = band_stats(_RISING_CURVE_ROW, (0.0, 10_000.0), _OPTS)
    assert stats is not None
    assert stats.slope_db_per_khz == 10.0


#: A track the detector can read: a source rate above its floor, on a frame whose bandwidth reaches past its own.
RATE = 96_000
BINS = 1025
BANDWIDTH = 48_000.0

#: Idle ticks that fill the playback gap exactly.
GAP_TICKS = math.ceil(junkcal.PERIOD_GAP_SECONDS / junkcal.TICK_SECONDS)


@pytest.fixture
async def bare_rig(live_manager: LiveManager) -> AsyncIterator[Rig]:
    """A playing engine on a track at ``RATE``, the manager's reader not yet attached to any stream."""
    mgr, _log, state = await live_manager(state=PLAYING, _metadata=metadata(RATE))
    world = Rig(mgr, state)
    yield world
    await world.close()


@pytest.fixture
async def rig(bare_rig: Rig) -> Rig:
    """``bare_rig`` with the reader holding a stream of audible frames."""
    await bare_rig.attach(frame(bins=BINS, bandwidth=BANDWIDTH))
    return bare_rig


@pytest.fixture
def dest(tmp_path: Path) -> Path:
    return tmp_path / "calibration"


async def test_a_playing_tick_appends_one_row_for_the_playing_rate(rig: Rig, dest: Path) -> None:
    await junkcal.Capture(dest).tick(rig.mgr)
    assert [[row["samplerate"] for row in rows] for rows in rows_by_file(dest)] == [[RATE]]


@pytest.mark.parametrize(
    ("idle_ticks", "rows_per_file"),
    [(GAP_TICKS - 1, [2]), (GAP_TICKS, [1, 1])],
)
async def test_the_playback_gap_closes_the_period_file_only_once_it_is_reached(
    rig: Rig, dest: Path, idle_ticks: int, rows_per_file: list[int]
) -> None:
    capture = junkcal.Capture(dest)
    await capture.tick(rig.mgr)
    await rig.engine_plays(playing=False)
    for _ in range(idle_ticks):
        await capture.tick(rig.mgr)
    await rig.engine_plays(playing=True)
    await capture.tick(rig.mgr)
    assert [len(rows) for rows in rows_by_file(dest)] == rows_per_file


async def test_an_ineligible_tick_writes_nothing(rig: Rig, dest: Path) -> None:
    capture = junkcal.Capture(dest)
    await rig.track_rate(44_100)
    await capture.tick(rig.mgr)
    await rig.track_rate(RATE)
    await capture.tick(rig.mgr)
    assert [len(rows) for rows in rows_by_file(dest)] == [1]


@pytest.mark.parametrize("change", ["samplerate", "bins", "bandwidth"])
async def test_a_change_of_samplerate_bins_or_bandwidth_opens_a_new_file(rig: Rig, dest: Path, change: str) -> None:
    capture = junkcal.Capture(dest)
    await capture.tick(rig.mgr)
    if change == "samplerate":
        await rig.track_rate(RATE * 2)
    elif change == "bins":
        await rig.attach(frame(bins=BINS * 2 - 1, bandwidth=BANDWIDTH))
    else:
        await rig.attach(frame(bins=BINS, bandwidth=BANDWIDTH - 1_000.0))
    await capture.tick(rig.mgr)
    assert [len(rows) for rows in rows_by_file(dest)] == [1, 1]


async def test_a_tick_after_a_failed_write_still_captures(rig: Rig, dest: Path) -> None:
    capture = junkcal.Capture(dest)
    block_directory(dest)
    await capture.tick(rig.mgr)
    unblock_directory(dest)
    await capture.tick(rig.mgr)
    assert [len(rows) for rows in rows_by_file(dest)] == [1]


async def test_a_row_has_no_spectrum_until_an_audible_frame_stands_behind_it(bare_rig: Rig, dest: Path) -> None:
    capture = junkcal.Capture(dest)
    await bare_rig.attach(frame(bins=BINS, bandwidth=BANDWIDTH, silent=True))
    await capture.tick(bare_rig.mgr)
    await bare_rig.attach(frame(bins=BINS, bandwidth=BANDWIDTH))
    await capture.tick(bare_rig.mgr)
    assert [row["spectrum"] is None for row in rows_by_file(dest)[0]] == [True, False]


async def test_a_rows_spectrum_starts_at_the_floor(rig: Rig, dest: Path) -> None:
    await junkcal.Capture(dest).tick(rig.mgr)
    spectrum = rows_by_file(dest)[0][0]["spectrum"]
    assert min(hz for hz, _db in spectrum) >= junkcal.SPECTRUM_FLOOR_HZ


async def test_a_rows_spectrum_keeps_the_bin_the_floor_lands_in(rig: Rig, dest: Path) -> None:
    await junkcal.Capture(dest).tick(rig.mgr)
    spectrum = rows_by_file(dest)[0][0]["spectrum"]
    assert min(hz for hz, _db in spectrum) - junkcal.SPECTRUM_FLOOR_HZ < BANDWIDTH / (BINS - 1)


@pytest.mark.parametrize("ticks", [1, 3])
async def test_run_captures_one_row_per_tick_of_the_manager_clock(rig: Rig, dest: Path, ticks: int) -> None:
    rig.start_capture(dest)
    await settled(rig.clock)
    await advanced(rig.clock, ticks * junkcal.TICK_SECONDS)
    assert [len(rows) for rows in rows_by_file(dest)] == [ticks + 1]


async def test_run_stops_capturing_once_cancelled(rig: Rig, dest: Path) -> None:
    task = rig.start_capture(dest)
    await settled(rig.clock)
    task.cancel()
    await advanced(rig.clock, 3 * junkcal.TICK_SECONDS)
    assert [len(rows) for rows in rows_by_file(dest)] == [1]
