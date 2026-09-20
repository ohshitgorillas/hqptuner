"""Per-block spectral statistics, the arithmetic of docs/junk-filter-autopilot-resource-20k.md §2.

One closed block of metering frames reads as three things: the per-bin minimum, the per-bin 90th percentile across
the block's frames, and the band scalars — the level just above whichever image fold reads higher, the level of the
15-18 kHz music band, and their distance. Levels are dB of power per Hz, so the width of the band each is read over
does not enter the distance between them.

The functions here mirror the scoring package under ``scripts/junkburst/`` (``jbcurves.Grid``, ``jbcurves.band_bins``
and ``band_level_db``, ``jbcandidates._per_hz_level``, ``_fold_mask``, ``mask_reading`` and ``fold_step``,
``jbcurves.median_smooth``, ``jbedge.p90_curve`` and ``g90_value``, ``jblabelled``'s per-bin minimum) rather than
importing them: the image installs the wheel, and that package is not in it (``Dockerfile``, ``pyproject.toml``
``packages``).

The record's ``p90`` is the raw percentile row ``jbedge.p90_curve`` smooths rather than that smoothed curve: the
9-bin median smooth belongs to the rule that reads the step, and ``p90_smoothed`` runs it there.
"""

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

# A power of zero has no dB, and the metering stream carries empty bins. The clamp puts them at the same floor the
# window minimum has always reported.
FLOOR_POWER = 1e-20
# The top bins carry the anti-imaging filter's transition, not the master's.
DROP_TOP_BINS = 25
SMOOTH_BINS = 9  # median-filter width for the curve the step is read on (odd)
# The two image folds the mask reading walks, the band it reads above each of them, and the music band it reads them
# against — jbconfig.MASK_FOLDS_HZ, MASK_ABOVE_HZ, CANDIDATE_E_REF_HZ.
MASK_FOLDS_HZ = (22_050.0, 24_000.0)
MASK_ABOVE_HZ = (300.0, 6_000.0)
MUSIC_BAND_HZ = (15_000.0, 18_000.0)
# Each of the loud-frame step's two bands stands this far clear of its fold and runs this wide — jbconfig's
# CANDIDATE_G_GUARD_HZ and CANDIDATE_G_BAND_HZ. The step walks the same two folds the mask reading does,
# jbconfig.EDGE_FOLDS_HZ.
STEP_GUARD_HZ = 300.0
STEP_BAND_HZ = 1_500.0


@dataclass(frozen=True)
class BlockRecord:
    """One closed block's curves and scalars.

    ``minimum`` spans every bin and ``p90`` the kept ones. The three scalars are NaN where neither fold carries both
    bands inside the grid, which is every block of a container whose bandwidth is 22.05 or 24 kHz.
    """

    minimum: list[float]
    p90: list[float]
    above_db: float
    music_db: float
    ratio_db: float


class Grid:
    """Bin/frequency arithmetic for one frame geometry."""

    def __init__(self, bins: int, bandwidth: float) -> None:
        """Hold the geometry's bin count and bandwidth, and the count of bins left after the top ones are dropped."""
        self.bins = bins
        self.bandwidth = bandwidth
        self.kept = bins - DROP_TOP_BINS

    def at(self, hz: float) -> int:
        """Return the kept-bin index nearest a frequency, clamped to the kept range."""
        return min(self.kept - 1, max(0, round(hz * (self.bins - 1) / self.bandwidth)))

    @property
    def hz_per_bin(self) -> float:
        """Return the frequency step between adjacent bins."""
        return self.bandwidth / (self.bins - 1)

    def hz(self, i: int) -> float:
        """Return the frequency of a bin index."""
        return i * self.hz_per_bin


def _band_bins(grid: Grid, lo_hz: float, hi_hz: float) -> tuple[int, int] | None:
    """Return the bin span of one band, or None when the band is not inside this grid.

    The bin lookup clamps, so a band above the geometry's bandwidth would otherwise read the top bin alone rather
    than read nothing.
    """
    if hi_hz > grid.hz(grid.kept - 1):
        return None
    return grid.at(lo_hz), grid.at(hi_hz)


def _per_hz_level(
    frames: npt.NDArray[np.float64], grid: Grid, lo_hz: float, hi_hz: float
) -> npt.NDArray[np.float64] | None:
    """Per frame: one band's summed power normalised to per Hz, in dB, or None when the band is off the grid."""
    span = _band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return None
    lo, hi = span
    power = np.power(10.0, frames[:, lo : hi + 1] / 10.0).sum(axis=1)
    level = 10.0 * np.log10(np.maximum(power, FLOOR_POWER))
    return np.asarray(level - 10.0 * np.log10((hi - lo + 1) * grid.hz_per_bin))


def _fold_reading(frames: npt.NDArray[np.float64], grid: Grid, fold_hz: float) -> tuple[float, float, float]:
    """Return the above-fold level, the music level and their distance at one fold, NaN throughout when off grid."""
    above = _per_hz_level(frames, grid, fold_hz + MASK_ABOVE_HZ[0], fold_hz + MASK_ABOVE_HZ[1])
    music = _per_hz_level(frames, grid, *MUSIC_BAND_HZ)
    if above is None or music is None:
        return float("nan"), float("nan"), float("nan")
    above_db, music_db = float(np.median(above)), float(np.median(music))
    return above_db, music_db, above_db - music_db


def _mask_reading(frames: npt.NDArray[np.float64], grid: Grid) -> tuple[float, float, float]:
    """Return the reading at whichever fold carries the higher above-fold level, NaN throughout when neither does."""
    carried = [r for r in (_fold_reading(frames, grid, hz) for hz in MASK_FOLDS_HZ) if math.isfinite(r[0])]
    if not carried:
        return float("nan"), float("nan"), float("nan")
    return max(carried, key=lambda r: r[0])


def block_record(rows: list[list[float]], bandwidth: float) -> BlockRecord:
    """Read one block's non-silent frames, linear per-bin power, into its curves and its three scalars."""
    frames = 10.0 * np.log10(np.maximum(np.asarray(rows, dtype=np.float64), FLOOR_POWER))
    grid = Grid(frames.shape[1], bandwidth)
    above_db, music_db, ratio_db = _mask_reading(frames, grid)
    return BlockRecord(
        minimum=[float(v) for v in frames.min(axis=0)],
        p90=[float(v) for v in np.percentile(frames[:, : grid.kept], 90, axis=0)],
        above_db=above_db,
        music_db=music_db,
        ratio_db=ratio_db,
    )


def _median_smooth(row: npt.NDArray[np.float64], width: int) -> npt.NDArray[np.float64]:
    """Return the running median along the bin axis, edges replicated — jbcurves.median_smooth in ``nearest`` mode."""
    half = width // 2
    windows = np.lib.stride_tricks.sliding_window_view(np.pad(row, half, mode="edge"), width)
    return np.asarray(np.median(windows, axis=1))


def p90_smoothed(record: BlockRecord, bins: int, bandwidth: float) -> npt.NDArray[np.float64]:
    """Return the record's 90th-percentile row smoothed at SMOOTH_BINS over the kept bins — jbedge.p90_curve."""
    grid = Grid(bins, bandwidth)
    return _median_smooth(np.asarray(record.p90[: grid.kept], dtype=np.float64), SMOOTH_BINS)


def _fold_step(curve: npt.NDArray[np.float64], grid: Grid, fold_hz: float) -> float:
    """Return the step in dB across one fold: the median of the band above it minus the median of the band below.

    Both bands are STEP_BAND_HZ wide and stand STEP_GUARD_HZ clear of the fold. The step is NaN where either band
    reaches past the top of the grid, so that fold drops out of the reading.
    """
    lo_span = _band_bins(grid, fold_hz - STEP_GUARD_HZ - STEP_BAND_HZ, fold_hz - STEP_GUARD_HZ)
    hi_span = _band_bins(grid, fold_hz + STEP_GUARD_HZ, fold_hz + STEP_GUARD_HZ + STEP_BAND_HZ)
    if lo_span is None or hi_span is None:
        return float("nan")
    lo_a, lo_b = lo_span
    hi_a, hi_b = hi_span
    return float(np.median(curve[hi_a : hi_b + 1]) - np.median(curve[lo_a : lo_b + 1]))


def loud_frame_step(record: BlockRecord, bins: int, bandwidth: float) -> tuple[float, float]:
    """Return the largest absolute fold step on the smoothed p90 curve, and the fold it was read at.

    NaN in both where neither fold lies inside the grid — jbedge.g90_value over jbcandidates.abs_steps.
    """
    grid = Grid(bins, bandwidth)
    curve = p90_smoothed(record, bins, bandwidth)
    read = ((fold_hz, _fold_step(curve, grid, fold_hz)) for fold_hz in MASK_FOLDS_HZ)
    steps = [(abs(step), fold_hz) for fold_hz, step in read if math.isfinite(step)]
    if not steps:
        return float("nan"), float("nan")
    return max(steps)
