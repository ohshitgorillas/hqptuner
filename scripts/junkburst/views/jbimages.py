"""Candidate I: the mirrored-spectrum correlation read per frame across an image fold, and its block share.

Candidate F in ``jbcandidates.py`` reads the same mirroring once per block, off the block's residual curve. I reads
it frame by frame off the frames themselves, so a block reports not one correlation but the share of its frames
whose correlation clears a cut: a mirrored image reflects in every frame it is present in, and a master whose own
content carries on past the fold reflects in none.
"""

from __future__ import annotations

import numpy as np
from jbcurves import Grid, band_bins

#: The two image folds I is read at, the folds every other fold candidate walks.
CANDIDATE_I_FOLDS_HZ = (22_050.0, 24_000.0)
#: How far each side of a fold the correlation reaches, in Hz. The two bands abut the fold, with no guard.
CANDIDATE_I_SPAN_HZ = 6_000.0
#: The frame correlation cuts a block's share is reported at.
CANDIDATE_I_CUTS = (0.5, 0.7, 0.9)
#: Fewest mirrored bin pairs a frame's correlation will be taken over.
MIN_CORR_BINS = 2


def _row_pearson(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Per row: the Pearson correlation of two equal-shaped frame-by-bin arrays, NaN where a row has no variation."""
    da = a - a.mean(axis=1, keepdims=True)
    db = b - b.mean(axis=1, keepdims=True)
    denom = np.sqrt((da * da).sum(axis=1)) * np.sqrt((db * db).sum(axis=1))
    out = np.full(a.shape[0], np.nan, dtype=np.float64)
    ok = denom > 0.0
    out[ok] = (da[ok] * db[ok]).sum(axis=1) / denom[ok]
    return out


def fold_frame_corr(frames: np.ndarray, grid: Grid, fold_hz: float) -> np.ndarray | None:
    """Per frame: the correlation across one fold, or ``None`` when either band falls outside the burst's grid.

    The band above the fold is read outward from it, and the band below is reversed so each pair of bins sits the
    same distance from the fold. Both bands run ``CANDIDATE_I_SPAN_HZ`` wide, and the shorter one sets the length.
    """
    lo_span = band_bins(grid, fold_hz - CANDIDATE_I_SPAN_HZ, fold_hz)
    hi_span = band_bins(grid, fold_hz, fold_hz + CANDIDATE_I_SPAN_HZ)
    if lo_span is None or hi_span is None:
        return None
    low = frames[:, lo_span[0] : lo_span[1] + 1][:, ::-1]
    high = frames[:, hi_span[0] : hi_span[1] + 1]
    n = min(low.shape[1], high.shape[1])
    if n < MIN_CORR_BINS:
        return None
    return _row_pearson(np.asarray(low[:, :n], dtype=np.float64), np.asarray(high[:, :n], dtype=np.float64))


def frame_corr(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Per frame: the larger of the two folds' correlations, NaN where neither fold carries one."""
    carried = [c for c in (fold_frame_corr(frames, grid, hz) for hz in CANDIDATE_I_FOLDS_HZ) if c is not None]
    if not carried:
        return np.full(frames.shape[0], np.nan, dtype=np.float64)
    stacked = np.stack(carried)
    best = np.where(np.isnan(stacked), -np.inf, stacked).max(axis=0)
    return np.asarray(np.where(np.isfinite(best), best, np.nan))


def block_share(corr: np.ndarray, cut: float) -> float:
    """Candidate I for one block at one cut: the share of its frames carrying a correlation that clears the cut.

    The share is taken over the frames that carry a correlation at all, and is NaN when none of them does: a frame
    with no reading is not a frame reading low.
    """
    read = corr[np.isfinite(corr)]
    if read.size == 0:
        return float("nan")
    return float(np.mean(read >= cut))
