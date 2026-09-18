"""The block-level candidate readings: AM and its veto, E2, E3 and F."""

from __future__ import annotations

import numpy as np
from jbconfig import (
    AMT_NEAR_HI_HZ,
    AMT_NEAR_LO_HZ,
    CANDIDATE_E_NUM_HZ,
    CANDIDATE_E_REF_HZ,
    CANDIDATE_F_FOLDS_HZ,
    CANDIDATE_F_INNER_HZ,
    CANDIDATE_F_OUTER_HZ,
    SMOOTH_BINS,
)
from jbcurves import Grid, band_bins, band_level_db, median_smooth, row_floor

#: Fewest mirrored bin pairs candidate F will take a correlation over.
MIN_CORR_BINS = 2


def am_value(existing_fall: float, walkup_fall: float) -> float:
    """Candidate AM for one block: the larger of the two edges' falls, NaN only when both carry no reading."""
    vals = [v for v in (existing_fall, walkup_fall) if np.isfinite(v)]
    return max(vals) if vals else float("nan")


def am_edge_hz(existing_fall: float, walkup_fall: float, existing_ceiling: float, walkup_ceiling: float) -> float:
    """Return the ceiling Hz of whichever edge produced AM's fall; NaN when neither edge carries a reading."""
    ex_ok, wu_ok = np.isfinite(existing_fall), np.isfinite(walkup_fall)
    if not ex_ok and not wu_ok:
        return float("nan")
    if ex_ok and (not wu_ok or existing_fall >= walkup_fall):
        return existing_ceiling
    return walkup_ceiling


def block_spread(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Per bin, kept bins only: the block's p90 minus p10 in dB across its frames."""
    kept = frames[:, : grid.kept]
    return np.asarray(np.percentile(kept, 90, axis=0) - np.percentile(kept, 10, axis=0))


def amt_medians(spread: np.ndarray, grid: Grid, edge_hz: float) -> tuple[float, float]:
    """Return the block spread's median just above the AM edge, and over the 15-18 kHz reference band.

    Both are NaN when the edge carries no reading or either band falls outside the burst's grid.
    """
    nan = float("nan")
    if not np.isfinite(edge_hz):
        return nan, nan
    near_span = band_bins(grid, edge_hz + AMT_NEAR_LO_HZ, edge_hz + AMT_NEAR_HI_HZ)
    ref_span = band_bins(grid, *CANDIDATE_E_REF_HZ)
    if near_span is None or ref_span is None:
        return nan, nan
    near_lo, near_hi = near_span
    ref_lo, ref_hi = ref_span
    return float(np.median(spread[near_lo : near_hi + 1])), float(np.median(spread[ref_lo : ref_hi + 1]))


def amt_call(near_med: float, ref_med: float, factor: float, *, am_fake: bool) -> bool:
    """AM's fake call, vetoed to real when the near-edge spread exceeds the reference spread times ``factor``."""
    if not am_fake:
        return False
    if not (np.isfinite(near_med) and np.isfinite(ref_med)):
        return True
    return not (near_med > ref_med * factor)


def e2_parts(frames: np.ndarray, grid: Grid) -> tuple[float, float]:
    """Candidate E2's two parts for one block: the dB spread of the upper band level and of the reference band level.

    Each band level is one number per frame — the linear power of the band's bins, summed and taken to dB — and its
    spread is the 90th percentile across the block's frames minus the 10th. Both parts are NaN when either band falls
    outside the burst's grid.
    """
    upper = band_level_db(frames, grid, *CANDIDATE_E_NUM_HZ)
    lower = band_level_db(frames, grid, *CANDIDATE_E_REF_HZ)
    if upper is None or lower is None:
        return float("nan"), float("nan")

    def spread(values: np.ndarray) -> float:
        return float(np.percentile(values, 90) - np.percentile(values, 10))

    return spread(upper), spread(lower)


def e3_parts(frames: np.ndarray, grid: Grid) -> tuple[float, float, float]:
    """Candidate E3's three parts for one block, all read off the block's per-bin median curve in dB.

    The curve is taken against a ``median_smooth`` copy of itself at the working width, and the parts are the mean
    absolute residual over the numerator band, the same over the reference band, and how far the reference band's own
    median sits above the row's ``FLOOR_PCT`` floor. All three are NaN when either band falls outside the grid.
    """
    nan = float("nan")
    num_span = band_bins(grid, *CANDIDATE_E_NUM_HZ)
    ref_span = band_bins(grid, *CANDIDATE_E_REF_HZ)
    if num_span is None or ref_span is None:
        return nan, nan, nan
    median_row = np.median(frames[:, : grid.kept].astype(np.float64), axis=0)[None, :]
    smoothed = median_smooth(median_row, SMOOTH_BINS)
    residual = np.abs(median_row - smoothed)[0]
    floor = float(row_floor(smoothed)[0])
    (num_lo, num_hi), (ref_lo, ref_hi) = num_span, ref_span
    return (
        float(residual[num_lo : num_hi + 1].mean()),
        float(residual[ref_lo : ref_hi + 1].mean()),
        float(np.median(median_row[0, ref_lo : ref_hi + 1]) - floor),
    )


def e2_value(upper_spread: float, lower_spread: float, min_lower_db: float) -> float:
    """E2 for one block, NaN when the lower band's spread is under ``min_lower_db`` or either part is NaN."""
    if not (np.isfinite(upper_spread) and np.isfinite(lower_spread)) or lower_spread < min_lower_db:
        return float("nan")
    if lower_spread <= 0.0:
        return float("nan")
    return upper_spread / lower_spread


def e3_value(num_resid: float, ref_resid: float, ref_over_floor: float, min_over_floor_db: float) -> float:
    """E3 for one block, NaN when the reference band sits under ``min_over_floor_db`` above the floor."""
    if not (np.isfinite(num_resid) and np.isfinite(ref_resid) and np.isfinite(ref_over_floor)):
        return float("nan")
    if ref_over_floor < min_over_floor_db or ref_resid <= 0.0:
        return float("nan")
    return num_resid / ref_resid


def f_folds(frames: np.ndarray, grid: Grid) -> list[float]:
    """Candidate F's correlation at each fold in ``CANDIDATE_F_FOLDS_HZ`` order, NaN where a fold lacks both bands.

    The block's per-bin median curve in dB, minus a ``median_smooth`` copy of itself, is the residual. For each fold
    frequency the Pearson correlation is taken between the residual over the band just below the fold and the
    residual over the band just above it, mirrored bin for bin so each pair sits the same distance from the fold.
    """
    median_row = np.median(frames[:, : grid.kept].astype(np.float64), axis=0)
    smoothed = median_smooth(median_row[None, :], SMOOTH_BINS)[0]
    residual = median_row - smoothed
    return [_fold_corr(residual, grid, fold_hz) for fold_hz in CANDIDATE_F_FOLDS_HZ]


def _fold_corr(residual: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Return the mirrored correlation across one fold, NaN when either side is off the grid or carries no variation."""
    lo_span = band_bins(grid, fold_hz - CANDIDATE_F_OUTER_HZ, fold_hz - CANDIDATE_F_INNER_HZ)
    hi_span = band_bins(grid, fold_hz + CANDIDATE_F_INNER_HZ, fold_hz + CANDIDATE_F_OUTER_HZ)
    if lo_span is None or hi_span is None:
        return float("nan")
    lo_a, lo_b = lo_span
    hi_a, hi_b = hi_span
    low = residual[lo_a : lo_b + 1]
    high = residual[hi_a : hi_b + 1][::-1]
    n = min(low.size, high.size)
    if n < MIN_CORR_BINS:
        return float("nan")
    low, high = low[-n:], high[-n:]
    if np.std(low) == 0.0 or np.std(high) == 0.0:
        return float("nan")
    c = float(np.corrcoef(low, high)[0, 1])
    return c if np.isfinite(c) else float("nan")


def f_value(frames: np.ndarray, grid: Grid) -> float:
    """Candidate F for one block: the larger of the two fold correlations, NaN when neither fold has both bands."""
    corrs = [c for c in f_folds(frames, grid) if np.isfinite(c)]
    return max(corrs) if corrs else float("nan")
