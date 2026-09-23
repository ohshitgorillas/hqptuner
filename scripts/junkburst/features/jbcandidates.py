"""The block-level candidate readings: AM and its veto, E2, E3, F, G, GC and H, and the quiet tag.

The edge candidates P, G90 and S are read in ``jbedge.py``, beside the tables that report them.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from jbconfig import (
    AMT_NEAR_HI_HZ,
    AMT_NEAR_LO_HZ,
    CANDIDATE_E_NUM_HZ,
    CANDIDATE_E_REF_HZ,
    CANDIDATE_F_FOLDS_HZ,
    CANDIDATE_F_INNER_HZ,
    CANDIDATE_F_OUTER_HZ,
    CANDIDATE_G_BAND_HZ,
    CANDIDATE_G_CONTROL_FOLDS_HZ,
    CANDIDATE_G_FOLDS_HZ,
    CANDIDATE_G_GUARD_HZ,
    CANDIDATE_H_OFFSET_HZ,
    CANDIDATE_M_FOLDS_HZ,
    CANDIDATE_M_OFFSETS_HZ,
    CANDIDATE_M_SHIFT_HZ,
    MASK_ABOVE_HZ,
    MASK_FOLDS_HZ,
    QUIET_MAX_LEVEL_DB,
    SMOOTH_BINS,
)
from jbcurves import Grid, band_bins, band_level_db, median_smooth, row_floor

#: Fewest mirrored bin pairs candidate F will take a correlation over.
MIN_CORR_BINS = 2
#: Fewest frames the mask reading will take its band-to-band correlation over.
MIN_CORR_FRAMES = 2


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


@dataclass
class BlockResidual:
    """One block's per-bin median curve in dB, that curve's ``median_smooth`` copy, and the residual between them.

    Candidates E3 and F read the same three arrays off the same block — E3 the absolute residual, F the signed one —
    so the median over the frames and the median filter over the bins are done once here.
    """

    median_row: np.ndarray
    smoothed: np.ndarray
    residual: np.ndarray


def block_residual(frames: np.ndarray, grid: Grid) -> BlockResidual:
    """Take one block's per-bin median curve over the kept bins, its smoothed copy and their difference."""
    median_row = np.median(frames[:, : grid.kept], axis=0)
    smoothed = median_smooth(median_row[None, :], SMOOTH_BINS)[0]
    return BlockResidual(median_row=median_row, smoothed=smoothed, residual=median_row - smoothed)


def e3_parts(block: BlockResidual, grid: Grid) -> tuple[float, float, float]:
    """Candidate E3's three parts for one block, all read off the block's per-bin median curve in dB.

    The parts are the mean absolute residual over the numerator band, the same over the reference band, and how far
    the reference band's own median sits above the row's ``FLOOR_PCT`` floor. All three are NaN when either band
    falls outside the grid.
    """
    nan = float("nan")
    num_span = band_bins(grid, *CANDIDATE_E_NUM_HZ)
    ref_span = band_bins(grid, *CANDIDATE_E_REF_HZ)
    if num_span is None or ref_span is None:
        return nan, nan, nan
    residual = np.abs(block.residual)
    floor = float(row_floor(block.smoothed[None, :])[0])
    (num_lo, num_hi), (ref_lo, ref_hi) = num_span, ref_span
    return (
        float(residual[num_lo : num_hi + 1].mean()),
        float(residual[ref_lo : ref_hi + 1].mean()),
        float(np.median(block.median_row[ref_lo : ref_hi + 1]) - floor),
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


def f_folds(block: BlockResidual, grid: Grid) -> list[float]:
    """Candidate F's correlation at each fold in ``CANDIDATE_F_FOLDS_HZ`` order, NaN where a fold lacks both bands.

    For each fold frequency the Pearson correlation is taken between the block's residual over the band just below
    the fold and the residual over the band just above it, mirrored bin for bin so each pair sits the same distance
    from the fold.
    """
    return [_fold_corr(block.residual, grid, fold_hz) for fold_hz in CANDIDATE_F_FOLDS_HZ]


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


def f_value(block: BlockResidual, grid: Grid) -> float:
    """Candidate F for one block: the larger of the two fold correlations, NaN when neither fold has both bands."""
    corrs = [c for c in f_folds(block, grid) if np.isfinite(c)]
    return max(corrs) if corrs else float("nan")


def min_curve(mins: np.ndarray, grid: Grid) -> np.ndarray:
    """Smooth one block's per-bin minimum row at ``SMOOTH_BINS`` over the kept bins — the curve candidate G reads."""
    return np.asarray(median_smooth(mins[None, : grid.kept], SMOOTH_BINS)[0])


def fold_step(curve: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Return the step in dB across one fold: the median of the band above it minus the median of the band below.

    Both bands are ``CANDIDATE_G_BAND_HZ`` wide and stand ``CANDIDATE_G_GUARD_HZ`` clear of the fold. The step is NaN
    when either band reaches past the top of the burst's grid, so that fold drops out of every reading below.
    """
    lo_span = band_bins(grid, fold_hz - CANDIDATE_G_GUARD_HZ - CANDIDATE_G_BAND_HZ, fold_hz - CANDIDATE_G_GUARD_HZ)
    hi_span = band_bins(grid, fold_hz + CANDIDATE_G_GUARD_HZ, fold_hz + CANDIDATE_G_GUARD_HZ + CANDIDATE_G_BAND_HZ)
    if lo_span is None or hi_span is None:
        return float("nan")
    lo_a, lo_b = lo_span
    hi_a, hi_b = hi_span
    return float(np.median(curve[hi_a : hi_b + 1]) - np.median(curve[lo_a : lo_b + 1]))


def abs_steps(curve: np.ndarray, grid: Grid, folds_hz: tuple[float, ...]) -> list[float]:
    """Return the absolute step at each of ``folds_hz`` that lies inside the burst's grid, the rest dropped."""
    return [abs(s) for s in (fold_step(curve, grid, hz) for hz in folds_hz) if np.isfinite(s)]


def g_value(curve: np.ndarray, grid: Grid) -> float:
    """Candidate G: the largest absolute fold step, NaN when neither fold lies inside the burst's grid."""
    steps = abs_steps(curve, grid, CANDIDATE_G_FOLDS_HZ)
    return max(steps) if steps else float("nan")


def _h_fold(curve: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Return one fold's H reading: its signed step less the mean of the same step ``CANDIDATE_H_OFFSET_HZ`` aside.

    NaN when the fold's own step is off the grid, or when neither offset step is.
    """
    step = fold_step(curve, grid, fold_hz)
    if not np.isfinite(step):
        return float("nan")
    offsets = [
        s
        for s in (
            fold_step(curve, grid, fold_hz - CANDIDATE_H_OFFSET_HZ),
            fold_step(curve, grid, fold_hz + CANDIDATE_H_OFFSET_HZ),
        )
        if np.isfinite(s)
    ]
    if not offsets:
        return float("nan")
    return step - float(np.mean(offsets))


def h_value(curve: np.ndarray, grid: Grid) -> float:
    """Candidate H: the largest absolute fold reading, NaN when no fold carries one."""
    readings = [abs(v) for v in (_h_fold(curve, grid, hz) for hz in CANDIDATE_G_FOLDS_HZ) if np.isfinite(v)]
    return max(readings) if readings else float("nan")


def g_signed_step(curve: np.ndarray, grid: Grid) -> float:
    """G's own step, kept signed: the step at whichever fold carries the largest absolute one.

    G is an absolute value, so a curve stepping up across the fold and one stepping down read the same. This keeps
    the sign of the step G was read from, and is NaN on exactly the blocks G is NaN on.
    """
    steps = [s for s in (fold_step(curve, grid, hz) for hz in CANDIDATE_G_FOLDS_HZ) if np.isfinite(s)]
    return max(steps, key=abs) if steps else float("nan")


def gc_value(curve: np.ndarray, grid: Grid, g: float) -> float:
    """Candidate GC: G less the median absolute step at the control folds, NaN when no control lies on the grid."""
    controls = abs_steps(curve, grid, CANDIDATE_G_CONTROL_FOLDS_HZ)
    if not np.isfinite(g) or not controls:
        return float("nan")
    return g - float(np.median(controls))


def block_quiet(block: BlockResidual, grid: Grid) -> bool:
    """Is this block quiet: its 15-18 kHz reference band's 90th percentile sits under ``QUIET_MAX_LEVEL_DB``.

    The band is E3's, read off the block's per-bin median curve, and the level is absolute — the metering's own dB,
    not a height above the block's own floor. A block whose grid does not reach the band reads loud.
    """
    span = band_bins(grid, *CANDIDATE_E_REF_HZ)
    if span is None:
        return False
    lo, hi = span
    return float(np.percentile(block.median_row[lo : hi + 1], 90)) < QUIET_MAX_LEVEL_DB


@dataclass
class MaskReading:
    """One block's mask reading: the level just above a fold, its distance below the music band, and their tracking.

    ``above_db`` and ``ratio_db`` are dB of power per Hz, so a band's width does not enter either number; ``corr`` is
    the Pearson correlation across the block's frames between the two band levels. All three are NaN when neither
    fold carries both bands inside the burst's grid.
    """

    above_db: float
    ratio_db: float
    corr: float


def _per_hz_level(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: one band's summed-channel power normalised to per-Hz, in dB, or ``None`` when it is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    level = band_level_db(frames, grid, lo_hz, hi_hz)
    if span is None or level is None:
        return None
    lo, hi = span
    return np.asarray(level - 10.0 * np.log10((hi - lo + 1) * grid.hz_per_bin))


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    """Pearson correlation of two frame series, NaN when either carries fewer than two frames or no variation."""
    if a.size < MIN_CORR_FRAMES or np.std(a) == 0.0 or np.std(b) == 0.0:
        return float("nan")
    c = float(np.corrcoef(a, b)[0, 1])
    return c if np.isfinite(c) else float("nan")


def _fold_mask(frames: np.ndarray, grid: Grid, fold_hz: float) -> MaskReading:
    """Return the mask reading at one fold, NaN throughout when either band falls outside the burst's grid."""
    nan = MaskReading(float("nan"), float("nan"), float("nan"))
    above = _per_hz_level(frames, grid, fold_hz + MASK_ABOVE_HZ[0], fold_hz + MASK_ABOVE_HZ[1])
    music = _per_hz_level(frames, grid, *CANDIDATE_E_REF_HZ)
    if above is None or music is None:
        return nan
    above_med, music_med = float(np.median(above)), float(np.median(music))
    return MaskReading(above_med, above_med - music_med, _pearson(above, music))


def mask_reading(frames: np.ndarray, grid: Grid) -> MaskReading:
    """Return the block's mask reading: whichever fold in ``MASK_FOLDS_HZ`` carries the higher above-fold level."""
    readings = [_fold_mask(frames, grid, hz) for hz in MASK_FOLDS_HZ]
    carried = [r for r in readings if np.isfinite(r.above_db)]
    if not carried:
        return MaskReading(float("nan"), float("nan"), float("nan"))
    return max(carried, key=lambda r: r.above_db)


def _bin_series(frames: np.ndarray, grid: Grid, hz: float) -> np.ndarray | None:
    """Per frame: the level in dB in the bin nearest one frequency, or ``None`` when it sits off the burst's grid."""
    if hz < 0.0 or hz > grid.hz(grid.kept - 1):
        return None
    return np.asarray(frames[:, grid.at(hz)])


def _mirror_offset(frames: np.ndarray, grid: Grid, fold_hz: float, offset_hz: float) -> float:
    """One offset's reading at one fold: the mirrored correlation less the same correlation with the upper bin moved.

    NaN when any of the three bins falls off the grid, or when either correlation has nothing to read.
    """
    low = _bin_series(frames, grid, fold_hz - offset_hz)
    high = _bin_series(frames, grid, fold_hz + offset_hz)
    far = _bin_series(frames, grid, fold_hz + offset_hz + CANDIDATE_M_SHIFT_HZ)
    if low is None or high is None or far is None:
        return float("nan")
    return _pearson(high, low) - _pearson(far, low)


def _mirror_fold(frames: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Candidate M at one fold: the median over the offsets that carry a reading, NaN when none does."""
    values = [v for v in (_mirror_offset(frames, grid, fold_hz, d) for d in CANDIDATE_M_OFFSETS_HZ) if np.isfinite(v)]
    return float(np.median(values)) if values else float("nan")


def m_value(frames: np.ndarray, grid: Grid) -> float:
    """Candidate M: the mirror test in time, read at whichever fold carries the larger value.

    NaN when neither fold in ``CANDIDATE_M_FOLDS_HZ`` lies on the burst's grid.
    """
    values = [v for v in (_mirror_fold(frames, grid, hz) for hz in CANDIDATE_M_FOLDS_HZ) if np.isfinite(v)]
    return max(values) if values else float("nan")
