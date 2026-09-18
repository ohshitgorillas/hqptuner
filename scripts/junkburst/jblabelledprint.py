"""Everything the owner-labelled run puts on stdout, so a run that cannot write its report still reports."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import numpy as np
from jbcandidates import block_residual, f_folds
from jbconfig import GROUPS, HEADLINE_WINDOW, REPORT, WINDOWS
from jbcurves import Grid, musical_frames, readings, readings_walkup, walk_curves
from jbderived import load_burst, musical_groups, summed_db
from jblabels import FAMILY_ORDER, family_of, normalize
from jbthresholds import LABEL_CANDIDATES, best_guard, calls_fake

if TYPE_CHECKING:
    from collections.abc import Callable

    from jbrun import LabelledRun

#: The albums whose every headline-window block is printed, and the test on the normalized album each is picked by.
TARGET_ALBUMS: dict[str, Callable[[str], bool]] = {
    "OK Computer OKNOTOK Disc 1": lambda a: all(k in normalize(a) for k in ("ok computer", "oknotok", "disc 1")),
    "Eternal Return": lambda a: normalize(a) == "eternal return",
}
FAMILY_CANDIDATES = ("A", "AW", "AM", "AMT", "advisor")


def print_family_totals(run: LabelledRun) -> None:
    """Per-family wrong-side totals at the headline window, steady blocks only."""
    family_of_stamp = {
        s: family_of(run.owner[s] or "", run.tracks.get(s, {}).get("album", "").strip()) for s in run.stamps
    }
    family_wrong = {f: dict.fromkeys(FAMILY_CANDIDATES, 0) for f in FAMILY_ORDER}
    family_blocks = dict.fromkeys(FAMILY_ORDER, 0)
    for cand in ("A", "AW", "AM", "advisor"):
        thr = run.scored["steady"][HEADLINE_WINDOW][cand]
        for stamp, value, lab in run.rows["steady"][HEADLINE_WINDOW][cand]:
            fam = family_of_stamp[stamp]
            if cand == "A":
                family_blocks[fam] += 1
            if calls_fake(value, thr) != (lab == "FAKE"):
                family_wrong[fam][cand] += 1
    amt_steady = run.amt_best["steady"]
    for (stamp, _, label, _, _), val in zip(run.amt_cache["steady"], amt_steady["values"], strict=True):
        if calls_fake(val, amt_steady) != (label == "FAKE"):
            family_wrong[family_of_stamp[stamp]]["AMT"] += 1
    print("family wrong totals (steady blocks, headline window)")
    print("family            blocks    A   AW   AM  AMT  advisor")
    for fam in FAMILY_ORDER:
        fw = family_wrong[fam]
        print(
            f"{fam:16s} {family_blocks[fam]:6d} {fw['A']:4d} {fw['AW']:4d} {fw['AM']:4d} {fw['AMT']:4d} "
            f"{fw['advisor']:4d}"
        )


def _print_burst_blocks(stamp: str) -> None:
    """One line per headline-window block of one burst: its fold correlations, both edges and both falls."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    musical = musical_frames(summed, grid)
    for b_index, g in enumerate(musical_groups(meta["arrived"], musical, HEADLINE_WINDOW)):
        p90_row = np.percentile(summed[g], 90, axis=0)[None, :]
        p90_curves = walk_curves(p90_row, grid)
        ceiling, fall = readings(p90_row, grid, curves=p90_curves)
        wu_ceiling, wu_fall = readings_walkup(p90_row, grid, curves=p90_curves)
        folds = f_folds(block_residual(summed[g], grid), grid)
        ce = f"{ceiling[0] / 1000:.2f}" if np.isfinite(ceiling[0]) else "none"
        wce = f"{wu_ceiling[0] / 1000:.2f}" if np.isfinite(wu_ceiling[0]) else "none"
        fa = f"{fall[0]:.2f}" if np.isfinite(fall[0]) else "nan"
        wfa = f"{wu_fall[0]:.2f}" if np.isfinite(wu_fall[0]) else "nan"
        f1 = f"{folds[0]:.3f}" if np.isfinite(folds[0]) else "nan"
        f2 = f"{folds[1]:.3f}" if np.isfinite(folds[1]) else "nan"
        print(f"{stamp} {b_index:3d} {f1:>8s} {f2:>6s} {ce:>6s} {wce:>7s} {fa:>7s} {wfa:>7s}")


def print_target_blocks(run: LabelledRun) -> None:
    """Every headline-window block of the albums under closest reading, burst by burst."""
    album_field = {s: run.tracks.get(s, {}).get("album", "").strip() for s in run.stamps}
    for name, match in TARGET_ALBUMS.items():
        target_stamps = sorted(s for s in run.stamps if match(album_field[s]))
        print(f"blocks for {name!r}: {len(target_stamps)} bursts")
        print("stamp block F22.05k F24k edge_A edge_AW fall_A fall_AW")
        for stamp in target_stamps:
            _print_burst_blocks(stamp)


def _print_headline_json(run: LabelledRun) -> None:
    """Print the headline counts and every candidate's headline threshold, as one JSON document."""
    head = run.scored["steady"][HEADLINE_WINDOW]
    print(
        json.dumps(
            {
                "report": str(REPORT),
                "bursts_labelled": len(run.graded),
                "bursts_duplicate": len(run.duplicates),
                "bursts_unlabelled": len(run.unlabelled),
                "fake_bursts": sum(1 for s in run.graded if run.owner[s] == "FAKE"),
                "real_bursts": sum(1 for s in run.graded if run.owner[s] == "REAL"),
                "transition_bursts": sum(1 for s in run.graded if run.group_of[s] == "transition"),
                "headline": {
                    c: {
                        "threshold": head[c]["threshold"],
                        "fake_high": head[c]["fake_high"],
                        "wrong": head[c]["wrong"],
                        "fake_called_real": head[c]["fake_called_real"],
                        "real_called_fake": head[c]["real_called_fake"],
                        "blocks": head[c]["blocks"],
                    }
                    for c in LABEL_CANDIDATES
                },
            },
            indent=2,
        )
    )


def _print_guard_sweep(run: LabelledRun) -> None:
    """Every guard row of E2 and E3, then the guard each one is best at."""
    for group in GROUPS:
        for cand in ("E2", "E3"):
            for row in run.guard_sweep[group][cand]:
                print(
                    f"guard group={group} cand={cand} guard={row['guard']:g} thr={row['threshold']:.4f} "
                    f"fake_high={row['fake_high']} wrong={row['wrong']}/{row['blocks']} "
                    f"no_reading={row['no_reading']} fake_called_real={row['fake_called_real']} "
                    f"real_called_fake={row['real_called_fake']}"
                )
            best = best_guard(run.guard_sweep[group][cand])
            print(
                f"guard_best group={group} cand={cand} guard={best['guard']:g} wrong={best['wrong']}/{best['blocks']} "
                f"no_reading={best['no_reading']} thr={best['threshold']:.4f} fake_high={best['fake_high']}"
            )


def print_summary(run: LabelledRun) -> None:
    """Print the headline JSON, a line per group, window and candidate, the per-album counts, then the guard sweep."""
    _print_headline_json(run)
    for group in GROUPS:
        for w in WINDOWS:
            for cand in LABEL_CANDIDATES:
                s = run.scored[group][w][cand]
                print(
                    f"group={group} window={w} cand={cand} thr={s['threshold']:.4f} fake_high={s['fake_high']} "
                    f"wrong={s['wrong']}/{s['blocks']} fake_called_real={s['fake_called_real']} "
                    f"real_called_fake={s['real_called_fake']}"
                )
    for name in sorted(run.albums):
        entry = run.albums[name]
        print(
            f"album={name!r} label={entry['label']} blocks={entry['blocks']} "
            + " ".join(f"{c}={entry['wrong'][c]}" for c in LABEL_CANDIDATES)
        )
    _print_guard_sweep(run)
