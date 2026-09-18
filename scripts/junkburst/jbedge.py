"""The edge candidates P, G90 and S: their block readings, and their tables over the blocks the album line keeps."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbcandidates import abs_steps
from jbconfig import (
    CANDIDATE_P_EDGE_HZ,
    CANDIDATE_P_HOLD_HZ,
    CANDIDATE_P_NEAR_HZ,
    CANDIDATE_P_REF_HZ,
    CANDIDATE_P_STEP_DB,
    CANDIDATE_S_INNER_HZ,
    CANDIDATE_S_OUTER_HZ,
    EDGE_FOLDS_HZ,
    HEADLINE_WINDOW,
    SMOOTH_BINS,
)
from jbcurves import band_bins, median_smooth
from jbmask import DECILES, MASK_SWEEP_ALBUM_LEVEL, MASK_SWEEP_CANDIDATE, SWEEP_LABELS, sweep_keep
from jbmirror import MIRROR_VETO_LEVEL, veto_loao_any

if TYPE_CHECKING:
    from jbcurves import Grid
    from jbrun import LabelledRun, MaskRow

#: The three edge candidates, in the order every table below carries them.
EDGE_CANDIDATES = ("P", "G90", "S")
#: Decimal places each candidate's cells are written to: P is a share of frames, G90 a step in dB, S a ratio.
EDGE_DECIMALS = {"P": 3, "G90": 2, "S": 3}

#: ``EdgeRows[candidate]`` is one (stamp, value, label) per steady block at the headline window.
EdgeRows = dict[str, list[tuple[str, float, str]]]


def _fold_on_grid(grid: Grid, fold_hz: float, reach_hz: float) -> bool:
    """Is a fold on this burst's grid, counting the span the reading reaches to either side of it."""
    return band_bins(grid, fold_hz - reach_hz, fold_hz + reach_hz) is not None


def frame_edges(frames: np.ndarray, grid: Grid) -> np.ndarray | None:
    """Per frame: the Hz of its own edge, or ``None`` when either of candidate P's two bands is off the grid.

    The edge is the highest bin inside ``CANDIDATE_P_EDGE_HZ`` above which every bin for the next
    ``CANDIDATE_P_HOLD_HZ`` sits under that frame's mean level over ``CANDIDATE_P_REF_HZ`` plus
    ``CANDIDATE_P_STEP_DB``. A frame with no such bin reads ``inf``, which lies within ``CANDIDATE_P_NEAR_HZ`` of no
    fold.
    """
    edge_span = band_bins(grid, *CANDIDATE_P_EDGE_HZ)
    ref_span = band_bins(grid, *CANDIDATE_P_REF_HZ)
    if edge_span is None or ref_span is None:
        return None
    lo, hi = edge_span
    ref_lo, ref_hi = ref_span
    ref = frames[:, ref_lo : ref_hi + 1].mean(axis=1)
    thr = ref + CANDIDATE_P_STEP_DB
    hold_bins = max(1, round(CANDIDATE_P_HOLD_HZ / grid.hz_per_bin))
    ext_hi = min(grid.kept - 1, hi + hold_bins)
    over = frames[:, lo : ext_hi + 1] >= thr[:, None]
    # ``clear[:, j]`` (bin lo + j) holds when no bin in the next ``hold_bins`` past it clears the threshold.
    clear = np.ones(over.shape, dtype=bool)
    for offset in range(1, hold_bins + 1):
        clear[:, : over.shape[1] - offset] &= ~over[:, offset:]
    candidates = clear[:, : hi - lo + 1]
    highest = (hi - lo) - candidates[:, ::-1].argmax(axis=1)
    return np.where(candidates.any(axis=1), grid.hz_of(lo + highest), np.inf)


def _p_fold(edges: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Candidate P at one fold: the share of frames whose edge sits within ``CANDIDATE_P_NEAR_HZ`` of it."""
    if not _fold_on_grid(grid, fold_hz, CANDIDATE_P_NEAR_HZ):
        return float("nan")
    return float(np.mean(np.abs(edges - fold_hz) <= CANDIDATE_P_NEAR_HZ))


def p_value(frames: np.ndarray, grid: Grid) -> float:
    """Candidate P: the pinned-edge share, read at whichever fold in ``EDGE_FOLDS_HZ`` pins the more frames.

    NaN when neither fold lies on the burst's grid, and when the per-frame edge itself cannot be read there.
    """
    edges = frame_edges(frames, grid)
    if edges is None:
        return float("nan")
    shares = [v for v in (_p_fold(edges, grid, hz) for hz in EDGE_FOLDS_HZ) if np.isfinite(v)]
    return max(shares) if shares else float("nan")


def p90_curve(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Smooth one block's per-bin 90th percentile row at ``SMOOTH_BINS`` over the kept bins — G90's own curve."""
    row = np.percentile(frames[:, : grid.kept], 90, axis=0)
    return np.asarray(median_smooth(np.asarray(row)[None, :], SMOOTH_BINS)[0])


def g90_value(frames: np.ndarray, grid: Grid) -> float:
    """Candidate G90: G's own largest absolute fold step, read on the block's p90 curve instead of its minimum."""
    steps = abs_steps(p90_curve(frames, grid), grid, EDGE_FOLDS_HZ)
    return max(steps) if steps else float("nan")


def block_drop(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Per bin, kept bins only: the block's p90 minus its minimum in dB across its frames."""
    kept = frames[:, : grid.kept]
    return np.asarray(np.percentile(kept, 90, axis=0) - kept.min(axis=0))


def _drop_mean(drop: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> float:
    """Return the mean of the per-bin drop over one band, NaN when that band falls outside the burst's grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return float("nan")
    lo, hi = span
    return float(drop[lo : hi + 1].mean())


def _s_fold(drop: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Candidate S at one fold: the mean drop over the band above it divided by the mean over the band below."""
    above = _drop_mean(drop, grid, fold_hz + CANDIDATE_S_INNER_HZ, fold_hz + CANDIDATE_S_OUTER_HZ)
    below = _drop_mean(drop, grid, fold_hz - CANDIDATE_S_OUTER_HZ, fold_hz - CANDIDATE_S_INNER_HZ)
    if not (np.isfinite(above) and np.isfinite(below)) or below <= 0.0:
        return float("nan")
    return above / below


def s_value(frames: np.ndarray, grid: Grid) -> float:
    """Candidate S: the spread collapse across a fold, read at whichever fold in ``EDGE_FOLDS_HZ`` collapses further.

    A collapse reads low, so the stronger of the two folds is the smaller ratio. NaN when neither fold carries both
    of its bands inside the burst's grid.
    """
    drop = block_drop(frames, grid)
    values = [v for v in (_s_fold(drop, grid, hz) for hz in EDGE_FOLDS_HZ) if np.isfinite(v)]
    return min(values) if values else float("nan")


def block_edge_values(block: np.ndarray, grid: Grid) -> dict[str, float]:
    """Return one block's three edge readings, keyed by candidate."""
    return {"P": p_value(block, grid), "G90": g90_value(block, grid), "S": s_value(block, grid)}


def edge_cell(cand: str, value: float) -> str:
    """One table cell: the candidate's own decimals, or ``none`` where the block carries no reading."""
    if not np.isfinite(value):
        return "none"
    return f"{value:.{EDGE_DECIMALS[cand]}f}"


def edge_deciles(rows: EdgeRows) -> dict[str, dict[str, dict[str, Any]]]:
    """Per candidate and per label: the blocks carrying a reading, and p0 to p100 of it over them."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for cand in EDGE_CANDIDATES:
        kept: dict[str, list[float]] = {label: [] for label in SWEEP_LABELS}
        for _, value, label in rows[cand]:
            if np.isfinite(value):
                kept[label].append(float(value))
        out[cand] = {
            label: {
                "blocks": len(values),
                "deciles": [float(np.percentile(values, p)) for p in DECILES] if values else [],
            }
            for label, values in kept.items()
        }
    return out


def edge_albums(rows: EdgeRows, row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key over the kept blocks: its label, how many it keeps, and the median of all three candidates.

    A ``BY_TRACK`` album keys one row per track, ``row_key_of`` already carrying its own name.
    """
    out: dict[str, dict[str, Any]] = {}
    for cand in EDGE_CANDIDATES:
        for stamp, value, label in rows[cand]:
            entry = out.setdefault(
                row_key_of[stamp], {"label": label, "kept": 0, "values": {c: [] for c in EDGE_CANDIDATES}}
            )
            if cand == EDGE_CANDIDATES[0]:
                entry["kept"] += 1
            if np.isfinite(value):
                entry["values"][cand].append(float(value))
    for entry in out.values():
        entry["median"] = {
            cand: (float(np.median(values)) if values else float("nan")) for cand, values in entry["values"].items()
        }
    return out


def edge_grades(
    mask_rows: list[MaskRow],
    g_rows: list[tuple[str, float, str]],
    rows: EdgeRows,
    album_of: dict[str, str],
) -> list[dict[str, Any]]:
    """Each candidate alone, then each one with G, graded held out over the kept blocks under the ratio veto."""
    other = MASK_SWEEP_CANDIDATE
    alone = [
        {"rule": cand, **veto_loao_any(mask_rows, [rows[cand]], album_of, MIRROR_VETO_LEVEL)}
        for cand in EDGE_CANDIDATES
    ]
    paired = [
        {
            "rule": f"{other} or {cand}",
            **veto_loao_any(mask_rows, [g_rows, rows[cand]], album_of, MIRROR_VETO_LEVEL),
        }
        for cand in EDGE_CANDIDATES
    ]
    return [*alone, *paired]


def edge_tables(
    run: LabelledRun,
) -> tuple[dict[str, dict[str, dict[str, Any]]], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Return the edge section's three parts, every one read over the blocks the album line keeps.

    The mask rows, G's rows and the three candidates' rows are the run's own steady headline blocks, all in the
    same block order.
    """
    mask_rows: list[MaskRow] = run.mask["steady"][HEADLINE_WINDOW]
    g_rows = run.rows["steady"][HEADLINE_WINDOW][MASK_SWEEP_CANDIDATE]
    rows: EdgeRows = run.edge["steady"]
    album_of = run.album_of
    keep = sweep_keep(mask_rows, MASK_SWEEP_ALBUM_LEVEL)
    kept_mask = [mask_rows[i] for i in keep]
    kept_g = [g_rows[i] for i in keep]
    kept: EdgeRows = {cand: [rows[cand][i] for i in keep] for cand in EDGE_CANDIDATES}
    return edge_deciles(kept), edge_albums(kept, run.row_key_of), edge_grades(kept_mask, kept_g, kept, album_of)


def _intro() -> str:
    """State what the three candidates read and which blocks the section is read over."""
    folds = " and ".join(f"{hz / 1000:g} kHz" for hz in EDGE_FOLDS_HZ)
    return (
        f"Over the blocks the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s. Each of the three "
        f"candidates is read at both folds, {folds}, and takes the reading of whichever fold reads stronger: the "
        f"larger share for P, the larger absolute step for G90, and the smaller ratio for S, a collapse reading low. "
        f"A block carries no reading where neither fold lies on the burst's grid. P is the share of the block's "
        f"frames whose own edge — the highest bin between 15 and 30 kHz above which every bin for the next "
        f"{CANDIDATE_P_HOLD_HZ / 1000:g} kHz sits under that frame's mean level over 34 to 40 kHz plus 10 dB — "
        f"lands within {CANDIDATE_P_NEAR_HZ:g} Hz of the fold. G90 is G's fold step "
        f"read on the block's per-bin 90th percentile curve rather than its per-bin minimum. S is the mean over "
        f"bins of the per-bin p90 minus the per-bin minimum across frames, over the band 300 Hz to 1.8 kHz above "
        f"the fold, divided by the same over the band 300 Hz to 1.8 kHz below it."
    )


def _decile_rows(run: LabelledRun) -> list[str]:
    """One row per candidate and label: its blocks, then p0 to p100 over them."""
    out = []
    for cand in EDGE_CANDIDATES:
        for label in SWEEP_LABELS:
            entry = run.edge_deciles[cand][label]
            cells = [edge_cell(cand, v) for v in entry["deciles"]] or ["none"] * len(DECILES)
            out.append(f"| {cand} | {label} | {entry['blocks']} | " + " | ".join(cells) + " |")
    return out


def _album_rows(run: LabelledRun) -> list[str]:
    """One row per album: its label, its kept blocks, and the median of all three candidates."""
    out = []
    for name, entry in sorted(run.edge_albums.items()):
        medians = " | ".join(edge_cell(cand, entry["median"][cand]) for cand in EDGE_CANDIDATES)
        out.append(f"| {name} | {entry['label']} | {entry['kept']} | {medians} |")
    return out


def edge_section(run: LabelledRun) -> list[str]:
    """Return the report's edge section: the three candidates' deciles, their per-album medians, then the grades."""
    other = MASK_SWEEP_CANDIDATE
    grade_intro = (
        f"Every rule is graded over the same kept blocks with each album held out in turn and every cut picked over "
        f"the other albums' kept blocks, the {MIRROR_VETO_LEVEL:g} dB ratio veto forcing a block real whatever the "
        f"cuts say. A combined rule reads fake when {other} clears its cut or the named candidate clears its own."
    )
    grade_rows = [
        f"| {row['rule']} | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.edge_grades
    ]
    return [
        "## Edge",
        "",
        _intro(),
        "",
        "| candidate | label | blocks | " + " | ".join(f"p{p}" for p in DECILES) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in DECILES) + " |",
        *_decile_rows(run),
        "",
        f"### Per-album kept blocks at {MASK_SWEEP_ALBUM_LEVEL:g} dB",
        "",
        "| album | label | kept | " + " | ".join(f"median {cand}" for cand in EDGE_CANDIDATES) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in EDGE_CANDIDATES) + " |",
        *_album_rows(run),
        "",
        "### Held-out grades",
        "",
        grade_intro,
        "",
        "| rule | held-out wrong | held-out fake called real | held-out real called fake |",
        "| --- | ---: | ---: | ---: |",
        *grade_rows,
        "",
    ]
