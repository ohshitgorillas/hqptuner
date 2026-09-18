"""Grid arithmetic and the curve readings every candidate is built from."""

from __future__ import annotations

import numpy as np
from jbconfig import (
    CLIFF_GUARD_HZ,
    CLIFF_REF_HZ,
    CLIFF_WINDOW_HZ,
    CONTENT_SMOOTH_BINS,
    CONTRAST_DB,
    DROP_TOP_BINS,
    EDGE_FLOOR_GUARD_DB,
    EDGE_STEP_DB,
    FLOOR_PCT,
    SMOOTH_BINS,
    WALKUP_REF_HZ,
    WALKUP_WINDOW_HZ,
)


def median_smooth(rows: np.ndarray, width: int) -> np.ndarray:
    """Median filter along the bin axis, edges padded by replication."""
    half = width // 2
    padded = np.pad(rows, ((0, 0), (half, half)), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, width, axis=1)
    return np.asarray(np.median(windows, axis=-1))


def row_floor(rows: np.ndarray) -> np.ndarray:
    """Return the junkadvisor floor of every row: its ``FLOOR_PCT`` percentile, indexed as that module indexes it."""
    n = rows.shape[1]
    idx = min(n - 1, (n * FLOOR_PCT) // 100)
    return np.asarray(np.sort(rows, axis=1)[:, idx])


class Grid:
    """Bin↔frequency arithmetic for one burst's spectrum grid."""

    def __init__(self, bins: int, bandwidth: float) -> None:
        """Hold the burst's bin count and bandwidth, and the count of bins left after the top ones are dropped."""
        self.bins = bins
        self.bandwidth = bandwidth
        self.kept = bins - DROP_TOP_BINS

    def at(self, hz: float) -> int:
        """Return the kept-bin index nearest a frequency, clamped to the kept range."""
        return min(self.kept - 1, max(0, round(hz * (self.bins - 1) / self.bandwidth)))

    def hz(self, i: int) -> float:
        """Return the frequency of a bin index."""
        return i * self.bandwidth / (self.bins - 1)

    def guard(self) -> int:
        """Return the cliff guard width in bins, at least one."""
        return max(1, round(CLIFF_GUARD_HZ * (self.bins - 1) / self.bandwidth))


def musical_frames(rows: np.ndarray, grid: Grid) -> np.ndarray:
    """Per row: does anything below 10 kHz clear the row's own floor by CONTRAST_DB.

    A row failing this carries no signal to read a ceiling off — digital silence, or a passage at the hiss floor —
    and says nothing about where the master's content stops.
    """
    kept = rows[:, : grid.kept]
    floor = row_floor(median_smooth(kept, SMOOTH_BINS))
    band = median_smooth(kept, CONTENT_SMOOTH_BINS)
    return (band[:, : grid.at(10_000.0) + 1] > (floor + CONTRAST_DB)[:, None]).any(axis=1)


def _walk_up(
    rows: np.ndarray, grid: Grid, window_hz: tuple[float, float], ref_hz: tuple[float, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Return (ceiling Hz or NaN, fall dB or NaN) per row for one window and one reference band.

    The edge is the first bin at least ``EDGE_STEP_DB`` below the reference band's mean, held below for the bin guard
    width, walking up in frequency from the top of the reference band; it counts only when it lands strictly inside
    the window. A row whose reference mean sits under ``EDGE_FLOOR_GUARD_DB`` above the row's own floor carries no
    reading: nothing there is loud enough to walk down from.
    """
    smoothed = median_smooth(rows[:, : grid.kept], SMOOTH_BINS)
    floor = row_floor(smoothed)
    bottom, top = grid.at(window_hz[0]), grid.at(window_hz[1])
    guard = grid.guard()
    ref_lo, ref_hi = grid.at(ref_hz[0]), grid.at(ref_hz[1])
    ref = smoothed[:, ref_lo : ref_hi + 1].mean(axis=1)
    start = ref_hi + 1
    ceiling = np.full(rows.shape[0], np.nan, dtype=np.float64)
    fall = np.full(rows.shape[0], np.nan, dtype=np.float64)
    for r in range(rows.shape[0]):
        if ref[r] - floor[r] < EDGE_FLOOR_GUARD_DB:
            continue
        row = smoothed[r]
        seg = row[start:]
        if seg.size < guard:
            continue
        below = seg <= (ref[r] - EDGE_STEP_DB)
        hits = np.flatnonzero(np.lib.stride_tricks.sliding_window_view(below, guard).all(axis=1))
        if hits.size == 0:
            continue
        edge = start + int(hits[0])
        if not (bottom < edge < top):
            continue
        ceiling[r] = grid.hz(edge)
        lo = min(grid.kept - 1, edge + guard)
        fall[r] = ref[r] - float(np.median(row[lo : grid.kept]))
    return ceiling, fall


def readings(
    rows: np.ndarray, grid: Grid, window_hz: tuple[float, float] | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Return (ceiling Hz or NaN, fall dB or NaN) for every summed-power dB row.

    The window is ``CLIFF_WINDOW_HZ`` unless the caller names another, and the reference band is ``CLIFF_REF_HZ``;
    both move with ``JB_CLIFF_LO``. A row with no edge inside the window carries no reading, read by the caller as a
    full verdict rather than as a number on the fall scale.
    """
    return _walk_up(rows, grid, window_hz or CLIFF_WINDOW_HZ, CLIFF_REF_HZ)


def readings_walkup(rows: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Return the fixed-band twin of ``readings``, unaffected by ``JB_CLIFF_LO``.

    It walks up from the top of ``junkadvisor``'s own 15-18 kHz reference band into its own 20-26 kHz window.
    Candidate AM reads the larger fall of this edge and the (possibly shifted) ``readings`` edge.
    """
    return _walk_up(rows, grid, WALKUP_WINDOW_HZ, WALKUP_REF_HZ)


def band_bins(grid: Grid, lo_hz: float, hi_hz: float) -> tuple[int, int] | None:
    """Return the bin span of one band, or ``None`` when the band is not inside this burst's grid.

    The grid's own bin lookup clamps, so a band above a burst's bandwidth would otherwise read the top bin alone
    rather than read nothing.
    """
    if hi_hz > grid.hz(grid.kept - 1):
        return None
    return grid.at(lo_hz), grid.at(hi_hz)


def band_level_db(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: the dB level of the linear power summed over one band, or ``None`` when the band is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return None
    lo, hi = span
    return np.asarray(10.0 * np.log10(np.maximum(np.power(10.0, frames[:, lo : hi + 1] / 10.0).sum(axis=1), 1e-20)))


def frame_content(rows: np.ndarray, grid: Grid, above_hz: float) -> np.ndarray:
    """Per row: does the band above ``above_hz`` clear that row's own floor by CONTRAST_DB."""
    kept = rows[:, : grid.kept]
    floor = row_floor(median_smooth(kept, SMOOTH_BINS))
    band = median_smooth(kept, CONTENT_SMOOTH_BINS)
    start = grid.at(above_hz)
    return (band[:, start:] > (floor + CONTRAST_DB)[:, None]).any(axis=1)
