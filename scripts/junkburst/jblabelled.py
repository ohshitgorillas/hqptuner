"""Stage 2 against the owner's labels: score every block, sweep every guard, and hand the run on to be reported."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from jbamt import amt_sweep
from jbcandidates import (
    am_edge_hz,
    am_value,
    amt_medians,
    block_quiet,
    block_residual,
    block_spread,
    e2_parts,
    e2_value,
    e3_parts,
    e3_value,
    f_value,
    g_signed_step,
    g_value,
    gc_value,
    h_value,
    m_value,
    mask_reading,
    min_curve,
)
from jbconfig import (
    BY_TRACK,
    CANDIDATE_C_HZ,
    CANDIDATE_E2_MIN_REF_SPREAD_DB,
    CANDIDATE_E3_MIN_REF_OVER_FLOOR_DB,
    DER,
    E2_GUARD_SWEEP,
    E3_GUARD_SWEEP,
    GROUPS,
    HEADLINE_WINDOW,
    LABEL_HZ,
    MASK_SWEEP_WINDOWS,
    WINDOWS,
)
from jbcurves import Grid, content_curves, frame_content, musical_frames, readings, readings_walkup, walk_curves
from jbderived import load_burst, musical_groups, summed_db
from jbedge import EDGE_CANDIDATES, block_edge_values, edge_tables
from jblabelledprint import print_family_totals, print_summary, print_target_blocks
from jblabelledreport import write_labelled_report
from jblabels import collapse_overlaps, load_labels, load_tracks, owner_label, primary_artist
from jbloao import loao_table
from jbmask import MASK_SWEEP_CANDIDATE, mask_sweep, mask_tables
from jbmirror import mirror_tables
from jbpolicy import loud_frame_sweep, policy_grade
from jbpolicyyield import policy_yield_augment
from jbquiet import QUIET_CANDIDATES, SPLITS, a_missed_albums, quiet_album_totals, split_keep, split_tables
from jbrun import AmtCache, Edge, GStep, LabelledRun, Mask, Mirror, Parts, Quiet, Rows, Scored
from jbthresholds import BASE_LABEL_CANDIDATES, LABEL_CANDIDATES, PartRow, best_threshold, calls_fake, sweep_guard
from jbtilt import TILT_READINGS, block_tilt_values, tilt_augment
from jbveto import real_veto

from hqptuner.engine import junkadvisor


@dataclass
class BurstContext:
    """One burst's frames, masks and header facts, read once and scored at every window."""

    stamp: str
    label: str
    group: str
    grid: Grid
    summed: np.ndarray
    lin: np.ndarray
    musical: np.ndarray
    content24: np.ndarray
    content22: np.ndarray
    arrived: list[float]
    samplerate: int
    bandwidth: float


@dataclass
class WindowCurves:
    """The fall and ceiling arrays of one burst at one window, one entry per block."""

    p90_fall: np.ndarray
    mean_fall: np.ndarray
    wu_fall: np.ndarray
    p90_ceiling: np.ndarray
    wu_ceiling: np.ndarray


@dataclass
class Accumulators:
    """Every collection a block appends to."""

    rows: Rows
    parts: Parts
    amt_cache: AmtCache
    quiet: Quiet
    mask: Mask
    mirror: Mirror
    gstep: GStep
    edge: Edge
    tilt: Edge


def _burst_context(stamp: str, label: str, group: str) -> BurstContext:
    """Read one burst and derive the masks every window scores against."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    return BurstContext(
        stamp=stamp,
        label=label,
        group=group,
        grid=grid,
        summed=summed,
        lin=np.power(10.0, summed / 10.0),
        musical=musical,
        content24=frame_content(summed, grid, LABEL_HZ, curves) & musical,
        content22=frame_content(summed, grid, CANDIDATE_C_HZ, curves) & musical,
        arrived=meta["arrived"],
        samplerate=int(meta["samplerate"] or 0),
        bandwidth=float(meta["bandwidth"]),
    )


def _block_values(
    ctx: BurstContext, g: list[int], block: np.ndarray, index: int, curves: WindowCurves
) -> tuple[dict[str, float], PartRow, bool, np.ndarray]:
    """Every base candidate's value for one block, the parts the guard sweep re-reads it from, its quiet tag, curve.

    The curve is the smoothed per-bin minimum G is read off, returned so the mask windows can take the signed step
    off it without smoothing the block a second time.
    """
    mins = block.min(axis=0)
    verdict = junkadvisor.classify([float(v) for v in mins], ctx.bandwidth, samplerate=ctx.samplerate, sdm=False)
    e2_upper, e2_lower = e2_parts(block, ctx.grid)
    residual = block_residual(block, ctx.grid)
    e3_num, e3_ref, e3_over = e3_parts(residual, ctx.grid)
    curve = min_curve(mins, ctx.grid)
    g_val = g_value(curve, ctx.grid)
    values = {
        "A": float(curves.p90_fall[index]),
        "AW": float(curves.wu_fall[index]),
        "AM": am_value(float(curves.p90_fall[index]), float(curves.wu_fall[index])),
        "B": float(curves.mean_fall[index]),
        "C": float(ctx.content22[g].sum()) / len(g),
        "advisor": 1.0 if (verdict or {}).get("filter") == "20k" else 0.0,
        "D": float(ctx.content24[g].sum()) / len(g),
        "E2": e2_value(e2_upper, e2_lower, CANDIDATE_E2_MIN_REF_SPREAD_DB),
        "E3": e3_value(e3_num, e3_ref, e3_over, CANDIDATE_E3_MIN_REF_OVER_FLOOR_DB),
        "F": f_value(residual, ctx.grid),
        "G": g_val,
        "GC": gc_value(curve, ctx.grid, g_val),
        "H": h_value(curve, ctx.grid),
    }
    return (
        values,
        (ctx.label, e2_upper, e2_lower, e3_num, e3_ref, e3_over),
        block_quiet(residual, ctx.grid),
        curve,
    )


def _amt_entry(
    ctx: BurstContext, block: np.ndarray, index: int, curves: WindowCurves, am_val: float
) -> tuple[str, float, str, float, float]:
    """AMT's inputs for one block: AM's value and the two spread medians its veto compares."""
    edge = am_edge_hz(
        float(curves.p90_fall[index]),
        float(curves.wu_fall[index]),
        float(curves.p90_ceiling[index]),
        float(curves.wu_ceiling[index]),
    )
    spread = block_spread(block, ctx.grid)
    near_med, ref_med = amt_medians(spread, ctx.grid, edge)
    return (ctx.stamp, am_val, ctx.label, near_med, ref_med)


def _score_window(ctx: BurstContext, window: float, acc: Accumulators) -> None:
    """Score one burst's blocks at one window into the accumulators."""
    groups = musical_groups(ctx.arrived, ctx.musical, window)
    if not groups:
        return
    p90_rows = np.stack([np.percentile(ctx.summed[g], 90, axis=0) for g in groups])
    mean_rows = np.stack([10.0 * np.log10(np.maximum(ctx.lin[g].mean(axis=0), 1e-20)) for g in groups])
    p90_curves = walk_curves(p90_rows, ctx.grid)
    p90_ceiling, p90_fall = readings(p90_rows, ctx.grid, curves=p90_curves)
    _, mean_fall = readings(mean_rows, ctx.grid)
    wu_ceiling, wu_fall = readings_walkup(p90_rows, ctx.grid, curves=p90_curves)
    curves = WindowCurves(
        p90_fall=p90_fall, mean_fall=mean_fall, wu_fall=wu_fall, p90_ceiling=p90_ceiling, wu_ceiling=wu_ceiling
    )
    for index, g in enumerate(groups):
        block = ctx.summed[g]
        values, part, quiet, curve = _block_values(ctx, g, block, index, curves)
        acc.parts[ctx.group][window].append(part)
        acc.quiet[ctx.group][window].append(quiet)
        for cand, value in values.items():
            acc.rows[ctx.group][window][cand].append((ctx.stamp, value, ctx.label))
        if window == HEADLINE_WINDOW:
            acc.amt_cache[ctx.group].append(_amt_entry(ctx, block, index, curves, values["AM"]))
            for cand, value in block_edge_values(block, ctx.grid).items():
                acc.edge[ctx.group][cand].append((ctx.stamp, value, ctx.label))
            for name, value in block_tilt_values(block, ctx.grid).items():
                acc.tilt[ctx.group][name].append((ctx.stamp, value, ctx.label))
        if window in MASK_SWEEP_WINDOWS:
            reading = mask_reading(block, ctx.grid)
            acc.mask[ctx.group][window].append((ctx.stamp, ctx.label, reading.above_db, reading.ratio_db, reading.corr))
            acc.mirror[ctx.group][window].append((ctx.stamp, m_value(block, ctx.grid), ctx.label))
            acc.gstep[ctx.group][window].append(g_signed_step(curve, ctx.grid))


def _score_all(graded: list[str], owner: dict[str, str | None], group_of: dict[str, str]) -> Accumulators:
    """Read every graded burst once and score every candidate at every window on its blocks."""
    acc = Accumulators(
        rows={g: {w: {c: [] for c in LABEL_CANDIDATES} for w in WINDOWS} for g in GROUPS},
        parts={g: {w: [] for w in WINDOWS} for g in GROUPS},
        amt_cache={g: [] for g in GROUPS},
        quiet={g: {w: [] for w in WINDOWS} for g in GROUPS},
        mask={g: {w: [] for w in MASK_SWEEP_WINDOWS} for g in GROUPS},
        mirror={g: {w: [] for w in MASK_SWEEP_WINDOWS} for g in GROUPS},
        gstep={g: {w: [] for w in MASK_SWEEP_WINDOWS} for g in GROUPS},
        edge={g: {c: [] for c in EDGE_CANDIDATES} for g in GROUPS},
        tilt={g: {r: [] for r in TILT_READINGS} for g in GROUPS},
    )
    for n, stamp in enumerate(graded, 1):
        label = owner[stamp]
        assert label is not None
        ctx = _burst_context(stamp, label, group_of[stamp])
        for window in WINDOWS:
            _score_window(ctx, window, acc)
        del ctx
        if n % 25 == 0 or n == len(graded):
            print(f"scored {n}/{len(graded)}", flush=True)
    return acc


def _thresholds(rows: Rows) -> Scored:
    """Pick every base candidate's own threshold, then derive AF from A's and F's."""
    scored: Scored = {
        g: {
            w: {
                c: best_threshold([v for _, v, _ in rows[g][w][c]], [lab for _, _, lab in rows[g][w][c]])
                for c in BASE_LABEL_CANDIDATES
            }
            for w in WINDOWS
        }
        for g in GROUPS
    }
    for group in GROUPS:
        for window in WINDOWS:
            scored[group][window]["AF"] = _derive_af(rows, scored, group, window)
    return scored


def _derive_af(rows: Rows, scored: Scored, group: str, window: float) -> dict[str, Any]:
    """AF for one group and window: fake when A calls fake at A's threshold, or F does at F's own."""
    a_thr, f_thr = scored[group][window]["A"], scored[group][window]["F"]
    af_values: list[float] = []
    af_labels: list[str] = []
    pairs = zip(rows[group][window]["A"], rows[group][window]["F"], strict=True)
    for (stamp, a_val, label), (_, f_val, _) in pairs:
        af_val = 1.0 if (calls_fake(a_val, a_thr) or calls_fake(f_val, f_thr)) else 0.0
        rows[group][window]["AF"].append((stamp, af_val, label))
        af_values.append(af_val)
        af_labels.append(label)
    return best_threshold(af_values, af_labels)


def _album_totals(rows: Rows, scored: Scored, album_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per-album wrong-side counts at the headline window, steady blocks only, each candidate at its own threshold."""
    albums: dict[str, dict[str, Any]] = {}
    for cand in LABEL_CANDIDATES:
        thr = scored["steady"][HEADLINE_WINDOW][cand]
        for stamp, value, lab in rows["steady"][HEADLINE_WINDOW][cand]:
            key = album_of[stamp]
            entry = albums.setdefault(key, {"label": lab, "blocks": 0, "wrong": dict.fromkeys(LABEL_CANDIDATES, 0)})
            if cand == LABEL_CANDIDATES[0]:
                entry["blocks"] += 1
            if calls_fake(value, thr) != (lab == "FAKE"):
                entry["wrong"][cand] += 1
    return albums


def _load_run() -> LabelledRun:
    """Resolve every burst's owner label, drop duplicate arrivals, and note each burst's group and album."""
    tracks = load_tracks()
    by_album, by_track = load_labels()
    stamps = sorted(p.stem for p in DER.glob("*.npy"))
    print(f"derived bursts={len(stamps)}", flush=True)
    owner = {stamp: owner_label(stamp, tracks, by_album, by_track) for stamp in stamps}
    unlabelled = sorted(s for s in stamps if owner[s] is None)
    labelled = [s for s in stamps if owner[s] is not None]
    graded, duplicates = collapse_overlaps(labelled)
    print(
        f"labelled={len(labelled)} duplicates={len(duplicates)} graded={len(graded)} unlabelled={len(unlabelled)}",
        flush=True,
    )
    # An empty album field keys on the artist too; a BY_TRACK album rows once per track in row_key_of instead.
    group_of: dict[str, str] = {}
    album_of: dict[str, str] = {}
    row_key_of: dict[str, str] = {}
    for s in stamps:
        row = tracks.get(s, {})
        artist, album, track = row.get("artist", "").strip(), row.get("album", "").strip(), row.get("track", "").strip()
        group_of[s] = "transition" if row.get("transition", "").strip() == "yes" else "steady"
        album_of[s] = album or f"{artist} (no album)"
        key = (primary_artist(artist), album)
        row_key_of[s] = f"{album_of[s]} — {track}" if by_album.get(key) == BY_TRACK else album_of[s]
    return LabelledRun(
        tracks=tracks,
        stamps=stamps,
        owner=owner,
        group_of=group_of,
        album_of=album_of,
        row_key_of=row_key_of,
        graded=graded,
        unlabelled=unlabelled,
        duplicates=duplicates,
    )


def report_labelled() -> None:
    """Grade every block against the owner's label instead of the spectrum rule, and write the report."""
    run = _load_run()
    acc = _score_all(run.graded, run.owner, run.group_of)
    run.rows, run.parts, run.amt_cache, run.quiet = acc.rows, acc.parts, acc.amt_cache, acc.quiet
    run.mask, run.mirror, run.gstep, run.edge = acc.mask, acc.mirror, acc.gstep, acc.edge
    run.tilt = acc.tilt
    run.scored = _thresholds(run.rows)
    run.guard_sweep = {
        group: {
            "E2": sweep_guard(run.parts[group][HEADLINE_WINDOW], "E2", E2_GUARD_SWEEP),
            "E3": sweep_guard(run.parts[group][HEADLINE_WINDOW], "E3", E3_GUARD_SWEEP),
        }
        for group in GROUPS
    }
    run.amt_best = amt_sweep(run.scored, run.amt_cache)
    print_family_totals(run)
    print_target_blocks(run)
    run.albums = _album_totals(run.rows, run.scored, run.album_of)
    run.split_scored = split_tables(run.rows, run.quiet)
    run.quiet_albums = quiet_album_totals(run.rows, run.quiet, run.split_scored, run.row_key_of)
    run.a_missed = a_missed_albums(run.rows, run.scored, run.row_key_of)
    head_rows = run.rows["steady"][HEADLINE_WINDOW]
    flags = run.quiet["steady"][HEADLINE_WINDOW]
    run.loao = loao_table(head_rows, run.album_of, LABEL_CANDIDATES, range(len(flags)))
    run.loao_split = {
        split: loao_table(head_rows, run.album_of, QUIET_CANDIDATES, split_keep(flags, split)) for split in SPLITS
    }
    run.mask_deciles, run.mask_albums = mask_tables(run.mask["steady"][HEADLINE_WINDOW], flags, run.row_key_of)
    rows_by_window = {w: run.rows["steady"][w] for w in MASK_SWEEP_WINDOWS}
    run.mask_sweep, run.mask_sweep_albums = mask_sweep(
        run.mask["steady"], rows_by_window, run.album_of, run.row_key_of, run.gstep["steady"]
    )
    g_head_rows = rows_by_window[HEADLINE_WINDOW][MASK_SWEEP_CANDIDATE]
    run.real_veto_deciles, run.real_veto_albums, run.real_veto_sweep = real_veto(
        run.mask["steady"][HEADLINE_WINDOW], g_head_rows, run.album_of, run.row_key_of
    )
    run.edge_deciles, run.edge_albums, run.edge_grades = edge_tables(run)
    run.loud_frame_sweep, run.policy_grade = loud_frame_sweep(run), policy_grade(run)
    policy_yield_augment(run)
    tilt_augment(run)
    run.mirror_deciles, run.mirror_albums, run.mirror_grades = mirror_tables(
        run.mask["steady"][HEADLINE_WINDOW],
        g_head_rows,
        run.mirror["steady"][HEADLINE_WINDOW],
        run.album_of,
        run.row_key_of,
    )
    print_summary(run)
    write_labelled_report(run)  # written last, so a run that cannot write it still leaves every number on stdout
