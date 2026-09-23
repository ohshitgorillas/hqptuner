"""Grid arithmetic and the curve readings every candidate is built from."""

from __future__ import annotations

from dataclasses import dataclass

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
from scipy.ndimage import median_filter


def median_smooth(rows: np.ndarray, width: int) -> np.ndarray:
    """Median filter along the bin axis, edges padded by replication.

    ``median_filter`` in ``nearest`` mode is the running median of the same replicated-edge windows, and every width
    here is odd, so it returns bin for bin what an explicit window sort returns — without materialising the
    ``width``-times copy of the array that a sliding-window sort needs.
    """
    return np.asarray(median_filter(rows, size=(1, width), mode="nearest"))


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

    @property
    def hz_per_bin(self) -> float:
        """Return the frequency step between adjacent bins."""
        return self.bandwidth / (self.bins - 1)

    def hz(self, i: int) -> float:
        """Return the frequency of a bin index."""
        return i * self.hz_per_bin

    def hz_of(self, i: np.ndarray) -> np.ndarray:
        """Return the frequencies of an array of bin indices."""
        return np.asarray(i * self.hz_per_bin, dtype=np.float64)

    def guard(self) -> int:
        """Return the cliff guard width in bins, at least one."""
        return max(1, round(CLIFF_GUARD_HZ * (self.bins - 1) / self.bandwidth))


@dataclass
class ContentCurves:
    """The two curves every content test over one burst reads: each row's floor, and the band it is contrasted with."""

    floor: np.ndarray
    band: np.ndarray


def content_curves(rows: np.ndarray, grid: Grid) -> ContentCurves:
    """Smooth one burst's rows at both widths once, so the tests below share the work instead of repeating it.

    The wide median over every frame and every kept bin is the most expensive arithmetic in a run, and each test that
    reads a different band otherwise recomputes the identical curves.
    """
    kept = rows[:, : grid.kept]
    return ContentCurves(
        floor=row_floor(median_smooth(kept, SMOOTH_BINS)), band=median_smooth(kept, CONTENT_SMOOTH_BINS)
    )


def musical_frames(rows: np.ndarray, grid: Grid, curves: ContentCurves | None = None) -> np.ndarray:
    """Per row: does anything below 10 kHz clear the row's own floor by CONTRAST_DB.

    A row failing this carries no signal to read a ceiling off — digital silence, or a passage at the hiss floor —
    and says nothing about where the master's content stops.
    """
    c = curves if curves is not None else content_curves(rows, grid)
    return (c.band[:, : grid.at(10_000.0) + 1] > (c.floor + CONTRAST_DB)[:, None]).any(axis=1)


@dataclass
class WalkCurves:
    """The rows every edge walk reads: smoothed at ``SMOOTH_BINS``, and the floor of each smoothed row.

    Both bands walked over one set of rows read the same smoothing and the same floor; only the window and the
    reference band differ, so the median filter and the floor sort are done once here and shared.
    """

    smoothed: np.ndarray
    floor: np.ndarray


def walk_curves(rows: np.ndarray, grid: Grid) -> WalkCurves:
    """Smooth one set of rows over the kept bins and take each row's floor off that smoothing."""
    smoothed = median_smooth(rows[:, : grid.kept], SMOOTH_BINS)
    return WalkCurves(smoothed=smoothed, floor=row_floor(smoothed))


def _first_run(below: np.ndarray, guard: int) -> tuple[np.ndarray, np.ndarray]:
    """Per row of a boolean array: the start of its first run of ``guard`` true bins, and whether it has one.

    A prefix sum differenced at the guard width counts every window in one pass, where a window view sorted per row
    costs the guard width again at every bin.
    """
    counts = np.cumsum(below, axis=1, dtype=np.int32)
    padded = np.concatenate([np.zeros((below.shape[0], 1), dtype=np.int32), counts], axis=1)
    runs = (padded[:, guard:] - padded[:, :-guard]) == guard
    return runs.argmax(axis=1), runs.any(axis=1)


def _tail_medians(smoothed: np.ndarray, lo: np.ndarray, kept: int) -> np.ndarray:
    """Per row: the median of that row's bins from its own ``lo`` up to the top kept bin."""
    cols = np.arange(kept)
    tail = np.where(cols[None, :] >= lo[:, None], smoothed, np.nan)
    return np.asarray(np.nanmedian(tail, axis=1))


def _walk_up(
    curves: WalkCurves, grid: Grid, window_hz: tuple[float, float], ref_hz: tuple[float, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Return (ceiling Hz or NaN, fall dB or NaN) per row for one window and one reference band.

    The edge is the first bin at least ``EDGE_STEP_DB`` below the reference band's mean, held below for the bin guard
    width, walking up in frequency from the top of the reference band; it counts only when it lands strictly inside
    the window. A row whose reference mean sits under ``EDGE_FLOOR_GUARD_DB`` above the row's own floor carries no
    reading: nothing there is loud enough to walk down from.
    """
    smoothed = curves.smoothed
    ceiling = np.full(smoothed.shape[0], np.nan, dtype=np.float64)
    fall = np.full(smoothed.shape[0], np.nan, dtype=np.float64)
    bottom, top = grid.at(window_hz[0]), grid.at(window_hz[1])
    guard = grid.guard()
    ref_lo, ref_hi = grid.at(ref_hz[0]), grid.at(ref_hz[1])
    ref = smoothed[:, ref_lo : ref_hi + 1].mean(axis=1)
    start = ref_hi + 1
    if smoothed.shape[1] - start < guard:
        return ceiling, fall
    hit, found = _first_run(smoothed[:, start:] <= (ref - EDGE_STEP_DB)[:, None], guard)
    edge = start + hit
    ok = found & (ref - curves.floor >= EDGE_FLOOR_GUARD_DB) & (edge > bottom) & (edge < top)
    if not ok.any():
        return ceiling, fall
    rows = np.flatnonzero(ok)
    ceiling[rows] = grid.hz_of(edge[rows])
    lo = np.minimum(grid.kept - 1, edge[rows] + guard)
    fall[rows] = ref[rows] - _tail_medians(smoothed[rows], lo, grid.kept)
    return ceiling, fall


def _content_edges(curves: WalkCurves, grid: Grid, window_hz: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    """Per row: ``junkadvisor._content_edge`` — the highest bin inside the window standing clear of the row's floor.

    Returns the edge index per row and whether that row has one. A row whose highest clear bin lands on either window
    end has none: at the bottom it sits at or below the corner recommended, at the top content carries on past the
    window. Reversing the window slice turns "highest true bin" into one ``argmax``, where the loop scans every bin of
    every row.
    """
    bottom, top = (grid.at(h) for h in window_hz)
    window = curves.smoothed[:, bottom : top + 1] > (curves.floor + CONTRAST_DB)[:, None]
    edge = top - window[:, ::-1].argmax(axis=1)
    return edge, window.any(axis=1) & (edge > bottom) & (edge < top)


def _cliff_falls(
    curves: WalkCurves, grid: Grid, window_hz: tuple[float, float], ref_hz: tuple[float, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Return (ceiling Hz or NaN, fall dB or NaN) per row for ``junkadvisor._cliff``'s edge and fall arithmetic.

    The fall is the mean of the reference band minus the median of everything from the guard width above the edge to
    the top kept bin; ``_cliff`` reads it against ``CLIFF_SPLIT_DB``, and the caller here reads it against its own cut.
    """
    ceiling = np.full(curves.smoothed.shape[0], np.nan, dtype=np.float64)
    fall = np.full(curves.smoothed.shape[0], np.nan, dtype=np.float64)
    edge, ok = _content_edges(curves, grid, window_hz)
    if not ok.any():
        return ceiling, fall
    rows = np.flatnonzero(ok)
    ref_lo, ref_hi = (grid.at(h) for h in ref_hz)
    ref = curves.smoothed[rows, ref_lo : ref_hi + 1].mean(axis=1)
    lo = np.minimum(grid.kept - 1, edge[rows] + grid.guard())
    ceiling[rows] = grid.hz_of(edge[rows])
    fall[rows] = ref - _tail_medians(curves.smoothed[rows], lo, grid.kept)
    return ceiling, fall


def readings(
    rows: np.ndarray,
    grid: Grid,
    window_hz: tuple[float, float] | None = None,
    curves: WalkCurves | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (ceiling Hz or NaN, fall dB or NaN) per row, read as ``junkadvisor._cliff`` reads one curve.

    The window is ``CLIFF_WINDOW_HZ`` unless the caller names another, and the reference band is ``CLIFF_REF_HZ``;
    both move with ``JB_CLIFF_LO``. A row with no edge inside the window carries no reading, read by the caller as a
    full verdict rather than as a number on the fall scale.
    """
    c = curves if curves is not None else walk_curves(rows, grid)
    return _cliff_falls(c, grid, window_hz or CLIFF_WINDOW_HZ, CLIFF_REF_HZ)


def readings_walkup(rows: np.ndarray, grid: Grid, curves: WalkCurves | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Return the fixed-band twin of ``readings``, unaffected by ``JB_CLIFF_LO``.

    It walks up from the top of ``junkadvisor``'s own 15-18 kHz reference band into its own 20-26 kHz window.
    Candidate AM reads the larger fall of this edge and the (possibly shifted) ``readings`` edge.
    """
    c = curves if curves is not None else walk_curves(rows, grid)
    return _walk_up(c, grid, WALKUP_WINDOW_HZ, WALKUP_REF_HZ)


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


def frame_content(rows: np.ndarray, grid: Grid, above_hz: float, curves: ContentCurves | None = None) -> np.ndarray:
    """Per row: does the band above ``above_hz`` clear that row's own floor by CONTRAST_DB."""
    c = curves if curves is not None else content_curves(rows, grid)
    start = grid.at(above_hz)
    return (c.band[:, start:] > (c.floor + CONTRAST_DB)[:, None]).any(axis=1)
