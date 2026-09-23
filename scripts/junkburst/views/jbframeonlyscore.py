"""Score three no-gate, per-raw-frame readings over the labelled corpus: the fold step, the edge step, the plateau.

The edge step is a swept 1 kHz-band fall, not a fixed fold, and the plateau spread is read above whichever edge
that frame found. ``jbframeonly.py`` tables what is scored here.

Unlike candidate FS in ``jbframestep.py`` this carries no lit gate: every raw frame of every steady headline block is
read, whether or not anything sits above the fold. A track's in-track time is its burst's ``position_s`` plus the
frame's own elapsed time since that burst's first frame, so bursts of the same track pool onto one timeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from jbconfig import DER, HEADLINE_WINDOW
from jbcurves import Grid, band_bins, content_curves, median_smooth, musical_frames
from jbderived import load_burst, musical_groups, summed_db
from jbframestep import FRAME_STEP_FOLDS_HZ, fold_frame_step
from jblabels import collapse_overlaps, load_labels, load_tracks, owner_label, primary_artist

#: The edge sweep: the lower 1 kHz band's own top, swept 19.0 to 24.5 kHz in 250 Hz steps.
EDGE_SWEEP_TOP_HZ = tuple(19_000.0 + 250.0 * i for i in range(23))
EDGE_BAND_HZ = 1_000.0

#: The plateau spread's own smoothing width, and how it is placed above whichever edge a frame found.
PLATEAU_SMOOTH_BINS = 9
PLATEAU_GUARD_HZ = 2_000.0
PLATEAU_TOP_HZ = 40_000.0
PLATEAU_TOP_GUARD_HZ = 4_000.0

#: The slope break's own band width and gap off the edge, and the count of top bins dropped from each fit.
SLOPE_BAND_HZ = 2_000.0
SLOPE_GAP_HZ = 250.0
SLOPE_DROP_BINS = 3


@dataclass(frozen=True)
class FrameRow:
    """One raw frame: its burst, label, track and in-track time, and its three no-gate readings."""

    stamp: str
    label: str
    track: str
    in_track_s: float
    fold_step: float
    edge_step: float
    edge_hz: float
    shelf: float
    edge_break: float
    plateau: float


@dataclass
class Corpus:
    """Every frame the run scores, burst by burst."""

    rows: list[FrameRow] = field(default_factory=list)


def _median_band(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: the median of that frame's own bins over one band, or ``None`` when the band is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return None
    lo, hi = span
    return np.asarray(np.median(frames[:, lo : hi + 1], axis=1))


def fold_reading(frames: np.ndarray, grid: Grid) -> np.ndarray:
    """Per frame: the larger of the two fold steps, NaN where neither fold's bands sit inside the burst's grid."""
    steps = [s for s in (fold_frame_step(frames, grid, hz) for hz in FRAME_STEP_FOLDS_HZ) if s is not None]
    if not steps:
        return np.full(frames.shape[0], np.nan, dtype=np.float64)
    return np.asarray(np.maximum.reduce(steps))


def edge_reading(frames: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per frame: the largest fall the sweep found, the sweep frequency it was found at, and the shelf reading there.

    The shelf reading is the median of the 1 kHz band directly under the winning lower band minus that lower
    band's own median, so a shelf reads near zero and a spur reads well below it. NaN throughout where no swept
    band pair sits inside the burst's grid; the shelf is NaN at a frame whose winning band has nothing under it.
    """
    n = frames.shape[0]
    best_step = np.full(n, -np.inf, dtype=np.float64)
    best_hz = np.full(n, np.nan, dtype=np.float64)
    best_shelf = np.full(n, np.nan, dtype=np.float64)
    any_valid = False
    for top_hz in EDGE_SWEEP_TOP_HZ:
        lower = _median_band(frames, grid, top_hz - EDGE_BAND_HZ, top_hz)
        upper = _median_band(frames, grid, top_hz, top_hz + EDGE_BAND_HZ)
        if lower is None or upper is None:
            continue
        any_valid = True
        under = _median_band(frames, grid, top_hz - 2.0 * EDGE_BAND_HZ, top_hz - EDGE_BAND_HZ)
        step = lower - upper
        better = step > best_step
        best_step = np.where(better, step, best_step)
        best_hz = np.where(better, top_hz, best_hz)
        shelf = under - lower if under is not None else np.full(n, np.nan, dtype=np.float64)
        best_shelf = np.where(better, shelf, best_shelf)
    if not any_valid:
        nan = np.full(n, np.nan, dtype=np.float64)
        return nan, nan, nan
    return best_step, best_hz, best_shelf


def plateau_value(row: np.ndarray, grid: Grid, edge_hz: float, top_cap_hz: float) -> float:
    """One frame's plateau spread: p90 minus p10 from ``PLATEAU_GUARD_HZ`` above its own edge to the cap."""
    if not np.isfinite(edge_hz):
        return float("nan")
    lo_hz = edge_hz + PLATEAU_GUARD_HZ
    if lo_hz >= top_cap_hz:
        return float("nan")
    lo, hi = grid.at(lo_hz), grid.at(top_cap_hz)
    if hi <= lo:
        return float("nan")
    band = row[lo : hi + 1]
    return float(np.percentile(band, 90) - np.percentile(band, 10))


def _band_slope(row: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> float:
    """Least-squares slope in dB/kHz of one band of one smoothed frame, its highest-dB bins dropped from the fit."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return float("nan")
    lo, hi = span
    bins = np.arange(lo, hi + 1)
    if bins.size <= SLOPE_DROP_BINS + 1:
        return float("nan")
    values = row[lo : hi + 1]
    order = np.argsort(values)[: bins.size - SLOPE_DROP_BINS]
    freqs_khz = grid.hz_of(bins[order]) / 1000.0
    slope, _ = np.polyfit(freqs_khz, values[order], 1)
    return float(slope)


def slope_break(row: np.ndarray, grid: Grid, edge_hz: float) -> float:
    """One frame's slope break: the above-edge band's own slope minus the below-edge band's, in dB per kHz."""
    if not np.isfinite(edge_hz):
        return float("nan")
    below = _band_slope(row, grid, edge_hz - SLOPE_GAP_HZ - SLOPE_BAND_HZ, edge_hz - SLOPE_GAP_HZ)
    above = _band_slope(row, grid, edge_hz + SLOPE_GAP_HZ, edge_hz + SLOPE_GAP_HZ + SLOPE_BAND_HZ)
    if not (np.isfinite(below) and np.isfinite(above)):
        return float("nan")
    return above - below


def _steady_bursts() -> list[dict[str, str]]:
    """Every graded steady burst, duplicate arrivals collapsed: its stamp, track key, position and owner label."""
    tracks = load_tracks()
    by_album, by_track = load_labels()
    stamps = sorted(p.stem for p in DER.glob("*.npy"))
    labelled = [s for s in stamps if owner_label(s, tracks, by_album, by_track) is not None]
    graded, duplicates = collapse_overlaps(labelled)
    print(f"derived={len(stamps)} labelled={len(labelled)} duplicates={len(duplicates)} graded={len(graded)}")
    out = []
    for stamp in graded:
        row = tracks.get(stamp, {})
        if row.get("transition", "").strip() == "yes":
            continue
        artist, track = row.get("artist", "").strip(), row.get("track", "").strip()
        key = f"{primary_artist(artist)} — {track}" if track else f"{artist or 'unknown'} (no track)"
        label = owner_label(stamp, tracks, by_album, by_track)
        assert label is not None
        out.append({"stamp": stamp, "track": key, "position_s": row.get("position_s", "0") or "0", "label": label})
    return out


def _burst_rows(entry: dict[str, str], corpus: Corpus) -> None:
    """Score one burst's every raw frame, over its steady headline blocks, into the corpus."""
    stamp, track, label = entry["stamp"], entry["track"], entry["label"]
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    smoothed = median_smooth(summed[:, : grid.kept], PLATEAU_SMOOTH_BINS)
    top_cap = min(PLATEAU_TOP_HZ, grid.bandwidth - PLATEAU_TOP_GUARD_HZ)
    arrived = meta["arrived"]
    t0 = float(arrived[0])
    base = float(entry["position_s"])
    for group in musical_groups(arrived, musical, HEADLINE_WINDOW):
        block = summed[group]
        fold = fold_reading(block, grid)
        edge_step, edge_hz, shelf = edge_reading(block, grid)
        for local_i, frame_i in enumerate(group):
            corpus.rows.append(
                FrameRow(
                    stamp=stamp,
                    label=label,
                    track=track,
                    in_track_s=base + (float(arrived[frame_i]) - t0),
                    fold_step=float(fold[local_i]),
                    edge_step=float(edge_step[local_i]),
                    edge_hz=float(edge_hz[local_i]),
                    shelf=float(shelf[local_i]),
                    edge_break=slope_break(smoothed[frame_i], grid, float(edge_hz[local_i])),
                    plateau=plateau_value(smoothed[frame_i], grid, float(edge_hz[local_i]), top_cap),
                )
            )


def score_corpus() -> Corpus:
    """Read every graded steady burst once and score its raw frames, no lit gate, into the corpus."""
    bursts = _steady_bursts()
    corpus = Corpus()
    for n, entry in enumerate(bursts, 1):
        _burst_rows(entry, corpus)
        if n % 25 == 0 or n == len(bursts):
            print(f"scored {n}/{len(bursts)}", flush=True)
    print(f"raw frames={len(corpus.rows)}", flush=True)
    return corpus
