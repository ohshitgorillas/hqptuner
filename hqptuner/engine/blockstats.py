"""Per-block spectral statistics, the arithmetic of docs/junk-filter-autopilot-resource.md §2.

One closed block of metering frames reads as three things: the per-bin minimum, the per-bin 90th percentile across
the block's frames, and the band scalars — the level just above whichever image fold reads higher, the level of the
15-18 kHz music band, and their distance. Levels are dB of power per Hz, so the width of the band each is read over
does not enter the distance between them.

The functions here mirror the scoring package under ``scripts/junkburst/`` (``jbcurves.Grid``, ``jbcurves.band_bins``
and ``band_level_db``, ``jbcandidates._per_hz_level``, ``_fold_mask`` and ``mask_reading``, ``jbedge.p90_curve``,
``jblabelled``'s per-bin minimum) rather than importing them: the image installs the wheel, and that package is not
in it (``Dockerfile``, ``pyproject.toml`` ``packages``).
"""

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from hqptuner.engine import junkadvisor

# A power of zero has no dB, and the metering stream carries empty bins. The clamp puts them at the same floor the
# window minimum has always reported.
FLOOR_POWER = 1e-20
# The two image folds the mask reading walks, the band it reads above each of them, and the music band it reads them
# against — jbconfig.MASK_FOLDS_HZ, MASK_ABOVE_HZ, CANDIDATE_E_REF_HZ.
MASK_FOLDS_HZ = (22_050.0, 24_000.0)
MASK_ABOVE_HZ = (300.0, 6_000.0)
MUSIC_BAND_HZ = (15_000.0, 18_000.0)


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
        self.kept = bins - junkadvisor.DROP_TOP_BINS

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
