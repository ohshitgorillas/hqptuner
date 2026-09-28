#!/usr/bin/env python3
"""Recompute junkadvisor's spur rule and candidate variants from stored minimum spectra.

Reads every junkcal capture, reconstructs the detector's view of the stored windowed-minimum curve, and reports per
recorded-verdict class how the spur rule and several candidate mechanisms behave.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from scipy.ndimage import median_filter

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence
    from typing import Any

DIR = Path("/srv/hqptuner/state/junkcal")
SPUR_MIN_HZ = 25_000.0
SPUR_DB = 15.0
BASELINE_BINS = 51
SMOOTH_BINS = 9
ABOVE_FLOOR_DB = 8.0
FLOOR_PCT = 10
DEAD = -199.9


def median_smooth(levels: Sequence[float], width: int) -> list[float]:
    """Match junkadvisor._median_smooth: a median filter whose window truncates at both edges."""
    if width <= 1:
        return list(levels)
    half = width // 2
    arr = np.asarray(levels, dtype=float)
    n = arr.size
    out = median_filter(arr, size=width, mode="nearest")
    for i in list(range(min(half, n))) + list(range(max(0, n - half), n)):
        out[i] = float(np.median(arr[max(0, i - half) : min(n, i + half + 1)]))
    return [float(v) for v in out]


def rank(sorted_levels: Sequence[float], idx: int) -> float:
    """Return the value at ``idx``, clamped to the sequence's bounds."""
    return sorted_levels[min(len(sorted_levels) - 1, max(0, idx))]


def load() -> Iterator[tuple[str, int, dict[str, Any]]]:
    """Yield every stored row as (capture file name, 1-based line number, parsed row)."""
    for path in sorted(DIR.glob("*.jsonl")):
        with path.open(encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, start=1):
                stripped = line.strip()
                if stripped:
                    yield path.name, lineno, json.loads(stripped)


def widths(excess: Sequence[float], thresh: float) -> list[int]:
    """Return the run lengths of consecutive bins whose excess is at or above ``thresh``."""
    runs, run = [], 0
    for value in excess:
        if value >= thresh:
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    return runs


def _dead_result() -> dict[str, Any]:
    """Return the full ``analyse`` shape for a dead row, with every reading field its empty value."""
    return {
        "dead": True,
        "floor": float("nan"),
        "cur_peak": float("nan"),
        "cur_hz": float("nan"),
        "fires": False,
        "peak3": float("nan"),
        "max_run": 0,
        "n_runs": 0,
        "over": 0,
        "band_max": float("nan"),
        "clear": float("nan"),
    }


def analyse(row: dict[str, Any]) -> dict[str, Any] | None:
    """Return the current spur rule and candidate variants' readings for one stored row."""
    spectrum = row.get("spectrum") or []
    if not spectrum:
        return None
    freqs = [float(p[0]) for p in spectrum]
    levels = [float(p[1]) for p in spectrum]
    if max(levels) <= DEAD:
        return _dead_result()
    total_bins = int(row["bins"])
    # The detector's floor is the 10th percentile of the 9-smoothed FULL grid; the capture stores only the tail.
    # The missing head is music-loud, so it sits above the floor: take the same absolute rank into the stored tail.
    floor_rank = (total_bins * FLOOR_PCT) // 100 - (total_bins - len(levels))
    floor = rank(sorted(median_smooth(levels, SMOOTH_BINS)), floor_rank)
    baseline = median_smooth(levels, BASELINE_BINS)
    start = next((i for i, f in enumerate(freqs) if f >= SPUR_MIN_HZ), len(freqs))
    band_excess, band_freqs, band_levels = [], [], []
    for i in range(start, len(freqs)):
        band_excess.append(levels[i] - baseline[i])
        band_freqs.append(freqs[i])
        band_levels.append(levels[i])
    if not band_excess:
        return _dead_result()
    gated = [
        (e, f) for e, f, lv in zip(band_excess, band_freqs, band_levels, strict=True) if lv > floor + ABOVE_FLOOR_DB
    ]
    cur_peak, cur_hz = max(gated) if gated else (float("nan"), float("nan"))
    fires = bool(gated) and cur_peak >= SPUR_DB
    # Variant A: hunt on a 3-bin median of the minimum curve (kills single-bin spikes, keeps a 3+ bin tone).
    smooth3 = median_smooth(levels, 3)
    base3 = median_smooth(smooth3, BASELINE_BINS)
    ex3 = [smooth3[i] - base3[i] for i in range(start, len(freqs))]
    g3 = [(e, f) for e, f, lv in zip(ex3, band_freqs, smooth3[start:], strict=True) if lv > floor + ABOVE_FLOOR_DB]
    peak3 = max(g3)[0] if g3 else float("nan")
    # Variant B: minimum width of the excess ridge at the current threshold.
    runs = widths(band_excess, SPUR_DB)
    # Variant C: how many separate bins clear the threshold at all (a forest of spikes is noise, not a tone).
    over = sum(1 for e in band_excess if e >= SPUR_DB)
    return {
        "dead": False,
        "floor": floor,
        "cur_peak": cur_peak,
        "cur_hz": cur_hz,
        "fires": fires,
        "peak3": peak3,
        "max_run": max(runs) if runs else 0,
        "n_runs": len(runs),
        "over": over,
        "band_max": max(band_levels),
        "clear": max(band_levels) - floor,
    }


def quant(values: Sequence[float]) -> tuple[float, float, float]:
    """Return the p10/p50/p90 of the finite values in ``values``."""
    usable = sorted(v for v in values if isinstance(v, float) and not math.isnan(v))
    if not usable:
        return (math.nan,) * 3
    return (rank(usable, len(usable) // 10), statistics.median(usable), rank(usable, len(usable) * 9 // 10))


def main() -> int:
    """Report per recorded-verdict class how the current spur rule and its candidates behave."""
    groups: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    dead: defaultdict[str, int] = defaultdict(int)
    out: list[str] = []
    for name, lineno, row in load():
        res = analyse(row)
        if res is None:
            continue
        label = str((row.get("verdict") or {}).get("filter", "none"))
        if res["dead"]:
            dead[label] += 1
            continue
        groups[label].append(res)
        out.append(
            f"{name}\t{lineno}\t{label}\t{row['samplerate']}\t{res['cur_peak']:.2f}\t{res['cur_hz']:.0f}\t"
            f"{int(res['fires'])}\t{res['peak3']:.2f}\t{res['max_run']}\t{res['n_runs']}\t{res['over']}\t"
            f"{res['clear']:.2f}\t{res['floor']:.2f}"
        )
    Path(sys.argv[1]).write_text("\n".join(out) + "\n", encoding="utf-8") if len(sys.argv) > 1 else None
    stats = ("cur_peak", "peak3", "max_run", "n_runs", "over", "clear", "floor")
    print(f"{'class':<6} {'rows':>5} {'fire%':>6} {'stat':<9} {'p10':>9} {'p50':>9} {'p90':>9}")
    for label in sorted(groups):
        bucket = groups[label]
        fire = 100.0 * sum(1 for r in bucket if r["fires"]) / len(bucket)
        for stat in stats:
            p10, p50, p90 = quant([float(r[stat]) for r in bucket])
            print(f"{label:<6} {len(bucket):>5} {fire:>5.1f}% {stat:<9} {p10:>9.2f} {p50:>9.2f} {p90:>9.2f}")
        print(f"{label:<6} dead rows: {dead[label]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
