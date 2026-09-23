#!/usr/bin/env python3
"""Read-only printer: per-1s-block G step, min-curve levels and reference-above-floor, plus a per-FAKE-album summary.

Reads only the derived captures under ``jbconfig.DER`` and the owner's ``tracks.tsv``/``labels.tsv`` join; writes
nothing. Table 1 covers one named burst per album at the headline 1 s window. Table 2 covers every block of every
burst of every album the owner's labels call FAKE, min and median of the reference-above-floor value.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "junkburst"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "junkburst" / "features"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "junkburst" / "views"))

import numpy as np
from jbcandidates import BlockResidual, block_residual, min_curve
from jbconfig import CANDIDATE_E_REF_HZ, CANDIDATE_G_BAND_HZ, CANDIDATE_G_FOLDS_HZ, CANDIDATE_G_GUARD_HZ
from jbcurves import Grid, band_bins, row_floor
from jbderived import blocks as split_blocks
from jbderived import load_burst, summed_db
from jblabels import load_labels, load_tracks, owner_label

#: Frequencies table 1 reads off the block's min-curve, in Hz.
MIN_CURVE_HZ = (21_000.0, 23_000.0, 25_000.0, 30_000.0)

#: (stamp, printed album label), one burst each, owner's given order.
TABLE1_BURSTS = (
    ("20260917T203931Z", "CALIGULA"),
    ("20260917T203119Z", "OK Computer OKNOTOK"),
    ("20260917T110507Z", "Masterpiece"),
    ("20260917T114252Z", "Lateralus"),
    ("20260917T203543Z", "One Beat"),
    ("20260918T050247Z", "The Glowing Man"),
    ("20260918T043326Z", "Celestial Blues"),
    ("20260918T075417Z", "Wine Dark Sea"),
    ("20260917T202257Z", "Morningrise"),
)


def signed_fold_step(curve: np.ndarray, grid: Grid, fold_hz: float) -> float:
    """Signed step in dB across one fold: median of the band above it minus median of the band below.

    Same bands as candidate G (``jbcandidates.fold_step``), kept signed rather than G's own ``abs()``.
    """
    lo_span = band_bins(grid, fold_hz - CANDIDATE_G_GUARD_HZ - CANDIDATE_G_BAND_HZ, fold_hz - CANDIDATE_G_GUARD_HZ)
    hi_span = band_bins(grid, fold_hz + CANDIDATE_G_GUARD_HZ, fold_hz + CANDIDATE_G_GUARD_HZ + CANDIDATE_G_BAND_HZ)
    if lo_span is None or hi_span is None:
        return float("nan")
    lo_a, lo_b = lo_span
    hi_a, hi_b = hi_span
    return float(np.median(curve[hi_a : hi_b + 1]) - np.median(curve[lo_a : lo_b + 1]))


def curve_value(curve: np.ndarray, grid: Grid, hz: float) -> float:
    """One min-curve value at a frequency, NaN when the frequency is off the burst's grid."""
    if hz > grid.hz(grid.kept - 1):
        return float("nan")
    return float(curve[grid.at(hz)])


def ref_above_floor(residual: BlockResidual, grid: Grid) -> float:
    """15-18 kHz reference band's 90th percentile minus the block floor, in dB; NaN off the grid.

    A height above the block's own floor, where ``jbcandidates.block_quiet`` reads the band's absolute level.
    """
    span = band_bins(grid, *CANDIDATE_E_REF_HZ)
    if span is None:
        return float("nan")
    lo, hi = span
    floor = float(row_floor(residual.smoothed[None, :])[0])
    return float(np.percentile(residual.median_row[lo : hi + 1], 90)) - floor


def burst_blocks(stamp: str) -> list[tuple[float, np.ndarray, Grid]]:
    """One burst's 1 s blocks as (block start seconds, summed-dB rows, grid)."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    arrived = meta["arrived"]
    t0 = arrived[0]
    return [(arrived[group[0]] - t0, summed[group], grid) for group in split_blocks(arrived, 1.0)]


def fmt(v: float) -> str:
    """One table cell: fixed 2 decimals, or blank for NaN."""
    return "" if not np.isfinite(v) else f"{v:.2f}"


def print_table1() -> None:
    """Every 1 s block of the nine named bursts: signed G step, min-curve levels, reference above floor."""
    cols = [
        "album",
        "stamp",
        "block",
        "t_s",
        "G@22.05k",
        "G@24k",
        "min@21k",
        "min@23k",
        "min@25k",
        "min@30k",
        "ref-15to18k_above_floor",
    ]
    print("| " + " | ".join(cols) + " |")
    print("|" + "|".join("---" for _ in cols) + "|")
    for stamp, album in TABLE1_BURSTS:
        for index, (t_s, block, grid) in enumerate(burst_blocks(stamp)):
            mins = block.min(axis=0)
            curve = min_curve(mins, grid)
            residual = block_residual(block, grid)
            row = [
                album,
                stamp,
                str(index),
                f"{t_s:.2f}",
                fmt(signed_fold_step(curve, grid, CANDIDATE_G_FOLDS_HZ[0])),
                fmt(signed_fold_step(curve, grid, CANDIDATE_G_FOLDS_HZ[1])),
                *(fmt(curve_value(curve, grid, hz)) for hz in MIN_CURVE_HZ),
                fmt(ref_above_floor(residual, grid)),
            ]
            print("| " + " | ".join(row) + " |")


def fake_album_stamps() -> dict[str, list[str]]:
    """Every FAKE album in the corpus, mapped to the stamps of its bursts, via tracks.tsv/labels.tsv."""
    tracks = load_tracks()
    by_album, by_track = load_labels()
    out: dict[str, list[str]] = {}
    for stamp, row in tracks.items():
        if owner_label(stamp, tracks, by_album, by_track) != "FAKE":
            continue
        out.setdefault(row.get("album", "").strip(), []).append(stamp)
    return out


def print_table2() -> None:
    """Every FAKE album: min and median of the reference-above-floor value across all its 1 s blocks."""
    print("\n| album | n_blocks | min ref-above-floor | median ref-above-floor |")
    print("|---|---|---|---|")
    stamps_by_album = fake_album_stamps()
    for album in sorted(stamps_by_album):
        values = []
        for stamp in stamps_by_album[album]:
            for _, block, grid in burst_blocks(stamp):
                values.append(ref_above_floor(block_residual(block, grid), grid))
        finite = [v for v in values if np.isfinite(v)]
        if not finite:
            print(f"| {album} | {len(values)} | | |")
            continue
        print(f"| {album} | {len(values)} | {min(finite):.2f} | {float(np.median(finite)):.2f} |")


def main() -> None:
    """Print both tables."""
    print_table1()
    print_table2()


if __name__ == "__main__":
    main()
