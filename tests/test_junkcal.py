"""The junk-calibration tick gate: what each tick's row-or-not decision reduces to.

Also covers ``scripts/junkcal/junkcal_view.band_stats``, the offline capture-file
reader's per-band statistics producer (its own module docstring): a row whose
stored curve rises linearly by 10 dB per 1000 Hz, so ``argmax_hz`` and
``slope_db_per_khz`` have an exact, hand-checkable answer.
"""

import argparse

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
