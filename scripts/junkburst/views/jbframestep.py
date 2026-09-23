"""Candidate FS: the fold step read per raw frame, and the lit-frame gate that says which frames carry one.

Candidate G in ``jbcandidates.py`` reads the step across an image fold once per block, off the block's per-bin
minimum curve, and G90 in ``jbedge.py`` reads the same step off the block's p90 curve. FS reads it frame by frame off
the frames themselves: the median of the band ending just below the fold minus the median of the band starting just
above it, so a frame whose content stops at the fold steps down across it and a frame carrying on through does not.

A frame is asked the question only where there is something above the fold to read: its mean level over the band
``FRAME_STEP_LIT_HZ`` above the fold, per Hz, must reach ``FRAME_STEP_LIT_DB``. That is the lit test. A frame lit at
both folds takes the fold whose above-fold level reads higher, the fold ``jbcandidates.mask_reading`` takes.
"""

from __future__ import annotations

import numpy as np
from jbcurves import Grid, band_bins, band_level_db

#: The two image folds FS is read at, the folds every other fold candidate walks.
FRAME_STEP_FOLDS_HZ = (22_050.0, 24_000.0)
#: Each of the step's two bands stands this far clear of its fold and runs this wide.
FRAME_STEP_GUARD_HZ = 300.0
FRAME_STEP_BAND_HZ = 1_500.0
#: The band above the fold the lit test reads, and the per-Hz level in dB it must reach for the frame to be lit.
FRAME_STEP_LIT_HZ = (300.0, 6_000.0)
FRAME_STEP_LIT_DB = -125.0
#: The lit-frame counts a block must reach for the rule to grade it at all.
FRAME_STEP_FLOORS = (5, 10, 20)
#: The per-frame step lines the share of lit frames is taken over, in dB.
FRAME_STEP_CUTS = (6.0, 8.0, 10.0, 12.0)
#: The shares of lit frames that must clear a step cut for the block to read junk.
FRAME_STEP_SHARE_CUTS = (0.3, 0.5, 0.7)


def per_hz_level(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: one band's power normalised to per-Hz, in dB, or ``None`` when the band is off the burst's grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    level = band_level_db(frames, grid, lo_hz, hi_hz)
    if span is None or level is None:
        return None
    lo, hi = span
    return np.asarray(level - 10.0 * np.log10((hi - lo + 1) * grid.hz_per_bin))


def _band_median(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: the median of the frame's own bins over one band, or ``None`` when the band is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return None
    lo, hi = span
    return np.asarray(np.median(frames[:, lo : hi + 1], axis=1))


def fold_frame_step(frames: np.ndarray, grid: Grid, fold_hz: float) -> np.ndarray | None:
    """Per frame: the step across one fold, or ``None`` when either band falls outside the burst's grid.

    The step is the median over the ``FRAME_STEP_BAND_HZ`` band ending ``FRAME_STEP_GUARD_HZ`` below the fold minus
    the median over the same-width band starting ``FRAME_STEP_GUARD_HZ`` above it, so a fall across the fold reads
    positive.
    """
    below = _band_median(
        frames, grid, fold_hz - FRAME_STEP_GUARD_HZ - FRAME_STEP_BAND_HZ, fold_hz - FRAME_STEP_GUARD_HZ
    )
    above = _band_median(
        frames, grid, fold_hz + FRAME_STEP_GUARD_HZ, fold_hz + FRAME_STEP_GUARD_HZ + FRAME_STEP_BAND_HZ
    )
    if below is None or above is None:
        return None
    return np.asarray(below - above)


def fold_lit_level(frames: np.ndarray, grid: Grid, fold_hz: float) -> np.ndarray | None:
    """Per frame: the per-Hz level over the lit band above one fold, or ``None`` when that band is off the grid."""
    return per_hz_level(frames, grid, fold_hz + FRAME_STEP_LIT_HZ[0], fold_hz + FRAME_STEP_LIT_HZ[1])


def _fold_arrays(frames: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray] | None:
    """Stack the per-frame step and lit level of every fold the burst's grid carries both readings at."""
    steps, levels = [], []
    for fold_hz in FRAME_STEP_FOLDS_HZ:
        step = fold_frame_step(frames, grid, fold_hz)
        level = fold_lit_level(frames, grid, fold_hz)
        if step is None or level is None:
            continue
        steps.append(step)
        levels.append(level)
    if not steps:
        return None
    return np.stack(steps), np.stack(levels)


def frame_steps(frames: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Per frame: its step, and whether it is lit.

    A frame is lit where the level over the lit band above a fold reaches ``FRAME_STEP_LIT_DB``, and takes the step
    of whichever lit fold reads the higher level there. An unlit frame carries a NaN step.
    """
    stacked = _fold_arrays(frames, grid)
    nan = np.full(frames.shape[0], np.nan, dtype=np.float64)
    if stacked is None:
        return nan, np.zeros(frames.shape[0], dtype=bool)
    steps, levels = stacked
    lit_mask = np.isfinite(levels) & (levels >= FRAME_STEP_LIT_DB)
    lit = lit_mask.any(axis=0)
    best = np.where(lit_mask, levels, -np.inf).argmax(axis=0)
    picked = steps[best, np.arange(steps.shape[1])]
    return np.asarray(np.where(lit, picked, np.nan)), np.asarray(lit)


def lit_steps(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Return the block's per-frame steps over its lit frames alone, in frame order; empty where none is lit."""
    step, lit = frame_steps(frames, grid)
    read = step[lit]
    return np.asarray(read[np.isfinite(read)])


def step_share(steps: np.ndarray, cut: float) -> float:
    """Return the share of a block's lit-frame steps reaching one cut, NaN where the block has no lit frame."""
    if steps.size == 0:
        return float("nan")
    return float(np.mean(steps >= cut))
