"""Stage 2 against the spectrum rule: label every block from its own frames and score the candidates on it."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import (
    CANDIDATE_C_HZ,
    CEILING_PROBE_LO_HZ,
    CLIFF_WINDOW_HZ,
    DER,
    HEADLINE_WINDOW,
    LABEL_HZ,
    LABEL_MIN_RATE,
    REPORT,
    WINDOWS,
)
from jbcurves import Grid, content_curves, frame_content, musical_frames, readings
from jbderived import load_burst, musical_groups, stats, summed_db, track_key
from jbreport import SpectrumSweep, write_report

from hqptuner.engine import blockstats, junkadvisor

if TYPE_CHECKING:
    from collections.abc import Callable

#: Fall arrays and the rows they were read from, per candidate, for one burst at one window.
Curves = dict[str, tuple[np.ndarray, np.ndarray]]


@dataclass
class BurstArrays:
    """One burst's grid and its two frame arrays, read once and scored at every window."""

    grid: Grid
    summed: np.ndarray
    lin: np.ndarray


def _read_burst(stamp: str) -> tuple[dict[str, Any], Grid, np.ndarray]:
    """Read one derived burst into its per-frame content masks and header facts, with the frames it was read from."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    content24 = frame_content(summed, grid, LABEL_HZ, curves) & musical
    burst = {
        "stamp": stamp,
        "samplerate": int(meta["samplerate"] or 0),
        "bandwidth": float(meta["bandwidth"]),
        "junk_filter": meta.get("junk_filter"),
        "track": track_key(meta),
        "frames": int(meta["frames"]),
        "arrived": meta["arrived"],
        "musical": musical,
        "musical_frames": int(musical.sum()),
        "content24": content24,
        "content24_frames": int(content24.sum()),
        "frames_above22": frame_content(summed, grid, CANDIDATE_C_HZ, curves) & musical,
    }
    return burst, grid, summed


def _burst_label(burst: dict[str, Any]) -> str:
    """Label one burst on its own frames; what plays before or after it decides nothing here."""
    if burst["samplerate"] < LABEL_MIN_RATE or not burst["musical_frames"]:
        return "unlabelled"
    return "full" if burst["content24_frames"] else "cliff"


def _track_rows(bursts: list[dict[str, Any]], burst_labels: dict[str, str]) -> list[dict[str, Any]]:
    """One orientation row per burst for the burst-label table."""
    return [
        {
            "track": b["stamp"],
            "label": burst_labels[b["stamp"]],
            "bursts": 1,
            "frames": b["frames"],
            "frames_above24": b["content24_frames"],
            "samplerate": b["samplerate"],
            "junk_filter": b["junk_filter"],
            "hot_fraction": (b["content24_frames"] / b["frames"]) if b["frames"] else 0.0,
        }
        for b in bursts
    ]


def _advisor_rows(
    burst: dict[str, Any], summed: np.ndarray, groups: list[list[int]], labels: list[str]
) -> list[dict[str, Any]]:
    """One row per block: what ``junkadvisor.classify`` calls the block's per-bin minimum, against the block's label."""
    out: list[dict[str, Any]] = []
    for index, (g, lab) in enumerate(zip(groups, labels, strict=True)):
        frames = summed[g]
        verdict = junkadvisor.classify(
            [float(v) for v in frames.min(axis=0)],
            burst["bandwidth"],
            samplerate=burst["samplerate"],
            sdm=False,
            block=blockstats.block_record(np.power(10.0, frames / 10.0).tolist(), burst["bandwidth"]),
        )
        predicted = "cliff" if (verdict or {}).get("filter") == "20k" else "full"
        out.append(
            {
                "stamp": burst["stamp"],
                "block": index,
                "label": lab,
                "predicted": predicted,
                "verdict": (verdict or {}).get("filter"),
            }
        )
    return out


def _ceiling_rows(stamp: str, grid: Grid, curves: Curves, labels: list[str]) -> list[dict[str, Any]]:
    """One row per cliff block whose candidate carries no fall reading, re-read with the window bottom moved down."""
    probe_window = (CEILING_PROBE_LO_HZ, CLIFF_WINDOW_HZ[1])
    probes = {name: (fall, readings(rows, grid, probe_window)[0]) for name, (rows, fall) in curves.items()}
    return [
        {"stamp": stamp, "block": index, "candidate": name, "ceiling": float(probed[index])}
        for index, lab in enumerate(labels)
        for name, (fall, probed) in probes.items()
        if lab == "cliff" and not np.isfinite(fall[index])
    ]


def _empty_sweep() -> dict[float, dict[str, Any]]:
    """Return the per-window per-candidate accumulator every block's value is appended to."""
    return {
        window: {name: {"cliff": [], "full": [], "series": {}} for name in ("p90", "mean", "count")}
        for window in WINDOWS
    }


def _record(window_sweep: dict[str, Any], stamp: str, labels: list[str], values_by_name: dict[str, np.ndarray]) -> None:
    """File one burst's block values at one window under each candidate's two sides and its own series."""
    for name, values in values_by_name.items():
        cand = window_sweep[name]
        for lab, value in zip(labels, values, strict=True):
            cand[lab].append(float(value))
        cand["series"][stamp] = [(lab, float(value)) for lab, value in zip(labels, values, strict=True)]


def _score_burst(
    burst: dict[str, Any], grid: Grid, summed: np.ndarray, sweep: dict[float, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Score one labelled burst at every window into ``sweep``, returning its advisor and ceiling rows."""
    arrays = BurstArrays(grid=grid, summed=summed, lin=np.power(10.0, summed / 10.0))
    advisor_rows: list[dict[str, Any]] = []
    ceiling_rows: list[dict[str, Any]] = []
    for window in WINDOWS:
        rows = _score_window(burst, arrays, window, sweep)
        if rows is not None:
            advisor_rows += rows["advisor"]
            ceiling_rows += rows["ceiling"]
    return advisor_rows, ceiling_rows


def _collect_and_score() -> tuple[list[dict[str, Any]], dict[str, str], SpectrumSweep]:
    """Read every derived burst once, label it on its own frames, and score it while its frames are still in hand."""
    stamps = sorted(p.stem for p in DER.glob("*.npy"))
    print(f"derived bursts={len(stamps)}", flush=True)
    sweep = _empty_sweep()
    bursts: list[dict[str, Any]] = []
    burst_labels: dict[str, str] = {}
    advisor_rows: list[dict[str, Any]] = []
    ceiling_rows: list[dict[str, Any]] = []
    for n, stamp in enumerate(stamps, 1):
        burst, grid, summed = _read_burst(stamp)
        bursts.append(burst)
        burst_labels[stamp] = _burst_label(burst)
        if burst_labels[stamp] != "unlabelled":
            advisor, ceiling = _score_burst(burst, grid, summed, sweep)
            advisor_rows += advisor
            ceiling_rows += ceiling
        del summed
        if n % 25 == 0 or n == len(stamps):
            print(f"scored {n}/{len(stamps)}", flush=True)
    advisor_wrong = sum(1 for row in advisor_rows if row["predicted"] != row["label"])
    result = SpectrumSweep(
        sweep=sweep, advisor_wrong=advisor_wrong, advisor_rows=advisor_rows, ceiling_rows=ceiling_rows
    )
    return bursts, burst_labels, result


def _score_window(
    burst: dict[str, Any],
    arrays: BurstArrays,
    window: float,
    sweep: dict[float, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]] | None:
    """Score one burst at one window into ``sweep``, and return the headline window's advisor and ceiling rows."""
    grid, summed, lin = arrays.grid, arrays.summed, arrays.lin
    groups = musical_groups(burst["arrived"], burst["musical"], window)
    if not groups:
        return None
    # Every block is labelled on its own musical frames: full when one of them carries content above
    # LABEL_HZ, cliff when none does. What the rest of the burst does decides nothing here.
    labels = ["full" if burst["content24"][g].any() else "cliff" for g in groups]
    p90_rows = np.stack([np.percentile(summed[g], 90, axis=0) for g in groups])
    mean_rows = np.stack([10.0 * np.log10(np.maximum(lin[g].mean(axis=0), 1e-20)) for g in groups])
    _, p90_fall = readings(p90_rows, grid)
    _, mean_fall = readings(mean_rows, grid)
    counts = np.array([float(burst["frames_above22"][g].sum()) / len(g) for g in groups])
    _record(sweep[window], burst["stamp"], labels, {"p90": p90_fall, "mean": mean_fall, "count": counts})
    if window != HEADLINE_WINDOW:
        return None
    curves: Curves = {"p90": (p90_rows, p90_fall), "mean": (mean_rows, mean_fall)}
    return {
        "advisor": _advisor_rows(burst, summed, groups, labels),
        "ceiling": _ceiling_rows(burst["stamp"], grid, curves, labels),
    }


def _flip_rows(
    series: dict[str, list[tuple[str, float]]], reads_cliff: Callable[[float], bool]
) -> tuple[int, list[dict[str, Any]]]:
    """Count the bursts whose verdict changes between adjacent blocks, and describe every such change."""
    flips = 0
    flip_list: list[dict[str, Any]] = []
    for stamp, entries in sorted(series.items()):
        sides = [reads_cliff(v) for _, v in entries]
        burst_flips = [i for i in range(1, len(sides)) if sides[i] != sides[i - 1]]
        if not burst_flips:
            continue
        flips += 1
        flip_list.extend(
            {
                "stamp": stamp,
                "label": f"{entries[i - 1][0]} to {entries[i][0]}",
                "block": i,
                "from": entries[i - 1][1],
                "to": entries[i][1],
            }
            for i in burst_flips
        )
    return flips, flip_list


def score_candidate(cand: dict[str, Any]) -> dict[str, Any]:
    """Score one candidate at one window: its gap, its threshold, its wrong-side blocks and its flips."""
    cliff, full = cand["cliff"], cand["full"]
    fin_cliff = [v for v in cliff if np.isfinite(v)]
    fin_full = [v for v in full if np.isfinite(v)]
    if not fin_cliff or not fin_full:
        return {
            "gap": 0.0,
            "margin": 0.0,
            "midpoint": 0.0,
            "wrong": 0,
            "blocks": len(cliff) + len(full),
            "flips": 0,
            "flip_list": [],
            "cliff_high": True,
            "cliff_stats": stats(cliff),
            "full_stats": stats(full),
            "median_gap": 0.0,
        }
    mc, mf = float(np.median(fin_cliff)), float(np.median(fin_full))
    cliff_high = mc >= mf
    # The gap is between the two sides' facing edges, and the threshold sits at its midpoint: the two sides carry very
    # different block counts, so a midpoint between the medians falls inside the larger side's own spread.
    high, low = (fin_cliff, fin_full) if cliff_high else (fin_full, fin_cliff)
    edge_high, edge_low = float(np.percentile(high, 10)), float(np.percentile(low, 90))
    gap = edge_high - edge_low
    midpoint = (edge_high + edge_low) / 2.0

    def reads_cliff(v: float) -> bool:
        """Read one block's side of the midpoint; a block with no reading cannot read cliff."""
        return bool(np.isfinite(v)) and ((v >= midpoint) == cliff_high)

    wrong = sum(1 for v in cliff if not reads_cliff(v)) + sum(1 for v in full if reads_cliff(v))
    flips, flip_list = _flip_rows(cand["series"], reads_cliff)
    return {
        "gap": gap,
        "margin": gap,
        "midpoint": midpoint,
        "wrong": wrong,
        "blocks": len(cliff) + len(full),
        "flips": flips,
        "flip_list": flip_list,
        "cliff_high": cliff_high,
        "cliff_stats": stats(fin_cliff),
        "full_stats": stats(fin_full),
        "median_gap": abs(mc - mf),
        "no_reading": {"cliff": len(cliff) - len(fin_cliff), "full": len(full) - len(fin_full)},
    }


def _print_summary(scored: dict[float, dict[str, Any]], result: SpectrumSweep) -> None:
    """Print the headline counts as JSON, then one line per window and candidate."""
    head = scored[HEADLINE_WINDOW]
    print(
        json.dumps(
            {
                "report": str(REPORT),
                "wrong_p90": head["p90"]["wrong"],
                "wrong_mean": head["mean"]["wrong"],
                "wrong_count": head["count"]["wrong"],
                "wrong_advisor": result.advisor_wrong,
                "blocks": head["p90"]["blocks"],
                "advisor_blocks": len(result.advisor_rows),
                "cliff_blocks_no_reading": len(result.ceiling_rows),
            },
            indent=2,
        )
    )
    for w in WINDOWS:
        for name in ("p90", "mean", "count"):
            s = scored[w][name]
            print(
                f"window={w} cand={name} gap={s['gap']:.2f} margin={s.get('margin', 0):.2f} "
                f"wrong={s['wrong']}/{s['blocks']} flips={s['flips']}"
            )


def report() -> None:
    """Score every candidate at every window and write the report."""
    bursts, burst_labels, result = _collect_and_score()
    track_rows = _track_rows(bursts, burst_labels)
    scored = {w: {name: score_candidate(cand) for name, cand in cands.items()} for w, cands in result.sweep.items()}
    write_report(track_rows, scored, result, len(bursts))
    _print_summary(scored, result)
