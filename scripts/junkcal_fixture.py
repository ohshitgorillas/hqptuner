#!/usr/bin/env python3
"""Build the junkcal fixture corpus: cut captures into albums, label them, keep the biting rows.

Two passes. ``shape`` streams the captures and writes one score record per row; ``emit`` cuts
each capture into albums, classes them and writes ``<album>.jsonl.gz`` plus ``labels.json``.

No threshold here comes from ``hqptuner/engine/junkadvisor.py``. Borrowed from it is reading
arithmetic only: the 9-bin median working curve and 10th-percentile floor, the 51-bin median
baseline, the 15-18 kHz reference band, the 1.5 kHz guard, the 20-26 kHz window and ``hz()``.
Every class boundary below was read off this corpus, at the trough or the gap of that
statistic's own distribution, and carries the reading that produced it.

``--inbox`` points a pass at a capture directory other than the production one, so a fork can
build its own corpus. ``STRUCK`` and ``FORCE_CUTS`` are keyed by capture stamp and reach
nothing in another inbox; a foreign capture mixing two signatures falls to the majority rule
rather than being cut, and needs its own ``FORCE_CUTS`` entry.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import tempfile
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

Curve = npt.NDArray[np.float64]
Row = dict[str, Any]
Score = dict[str, Any]

SRC = Path("/srv/hqptuner/state/junkcal")
OUT = Path(__file__).resolve().parent.parent / "tests" / "support" / "fixtures" / "junkcal"

DROP_TOP_BINS = 25
SMOOTH_BINS = 9
SPUR_BASELINE_BINS = 51
FLOOR_PERCENTILE = 10

CLIFF_WINDOW_HZ = (20_000.0, 26_000.0)
CLIFF_REF_HZ = (15_000.0, 18_000.0)
CLIFF_GUARD_HZ = 1_500.0
SPUR_MIN_HZ = 25_000.0
SPUR_CORNER_SPLIT_HZ = 45_000.0
SPUR_TOL_BINS = 2
RAMP_LO_HZ = 25_000.0
RAMP_MIN_RATE = 176_400
RAMP_TOP_FRAC = 0.85

#: Where a 20k filter has nothing to cut: content that has already stopped below this.
SUB20_HZ = 20_000.0

#: Level above the row's own floor that a bin must reach to carry a ceiling or a spur. The
#: trough of the corpus histogram of (smoothed curve minus floor): floor mode 222097 rows at
#: 1 dB, first local minimum 68205 at 11 dB, content mode 75127 at 15 dB.
CONTRAST_DB = 11.0

#: Reference band minus the median above the ceiling, flat rows only. 117 flat rows carry a
#: positive depth; the series is dense to 27.39 dB and resumes at 31.90, a 4.51 dB gap, and no
#: other adjacent pair between 8 and 44 dB is more than 2.5 dB apart.
CLIFF_SPLIT_DB = 30.0

#: Excess over the 51-bin baseline above 25 kHz. Two modes: 769 rows at 4 dB, falling to a
#: local minimum of 37 at 22 dB, rising again to 130 at 28 dB.
SPUR_SPLIT_DB = 22.0

#: Top-band level above the floor at 176.4 kHz and up, with a rising slope. A three-row gap at
#: 1-2 dB separates floor wobble from a top band that carries energy.
RAMP_TOP_SPLIT_DB = 3.0

#: A spur-absent row sits at least this far below its album's strongest excess at the same
#: bin. Twelve per-album values; widest gap 13.08 -> 22.66, midpoint 17.87, and no other
#: adjacent pair exceeds 5.92 dB.
DROP_DB = 17.9

#: Share of an album's rows whose content stops below SUB20_HZ for the album to be lossy
#: sub-case material. Read at the 0.667 -> 0.829 gap in the per-album distribution.
LOSSY_FRACTION = 0.75

#: Neutral rows bridged inside one content run. Every value in [22, 49] gives the identical
#: segmentation, so the smallest is taken.
GAP = 22

#: Positives a run needs to be a run. 4, because 20260914T013517Z carries four cliff rows and
#: nothing else, and at 5 that album does not exist.
MIN_RUN = 4

#: Source rows an album carries at the least, nulls included.
MIN_ROWS = 5

#: Captures that yield no album, with the reading that struck each one.
STRUCK: dict[str, str] = {
    "20260914T042700Z": "near-silence: ref_rel 3.8/3.9/5.6 dB, free edge 3.1/28.9/8.3 kHz",
}

#: Source lines where a capture holds several albums whose boundaries are material steps --
#: the floor band and where content stops -- rather than a change of signature. 20260912T235103Z
#: steps at 49 and 70, where the free edge jumps to ~90 kHz and the floor drops past -131 dB,
#: back to band-limited at 55, and at 73, 95, 103 and 127 across its tail.
FORCE_CUTS: dict[str, list[int]] = {
    "20260912T235103Z": [49, 55, 70, 73, 95, 103, 127],
}


def median_smooth(levels: Curve, width: int) -> Curve:
    """Return the running median of a curve, the window narrowing at both ends."""
    half = width // 2
    n = len(levels)
    if n <= half:
        return np.full(n, float(np.median(levels)))
    windows = np.lib.stride_tricks.sliding_window_view(levels, width)
    out: Curve = np.empty(n, dtype=float)
    out[half : n - half] = np.median(windows, axis=1)
    for i in list(range(half)) + list(range(n - half, n)):
        out[i] = float(np.median(levels[max(0, i - half) : min(n, i + half + 1)]))
    return out


def percentile_floor(smoothed: Curve) -> float:
    """Return the row's own noise floor, the 10th percentile of its smoothed curve."""
    ordered = np.sort(smoothed)
    return float(ordered[min(len(ordered) - 1, (len(ordered) * FLOOR_PERCENTILE) // 100)])


def band_mean(levels: Curve, lo: int, hi: int) -> float:
    """Return the mean level over a bin range, or a stand-in floor for an empty range."""
    band = levels[lo : hi + 1]
    return float(band.mean()) if len(band) else -200.0


def band_median(levels: Curve, lo: int, hi: int) -> float:
    """Return the median level over a bin range, or a stand-in floor for an empty range."""
    band = levels[lo : hi + 1]
    return float(np.median(band)) if len(band) else -200.0


def curve(row: Row) -> tuple[Curve, Curve, str]:
    """Return frequencies, levels and format: a pair row is [hz, db], a flat row is levels."""
    spec = row["spectrum"]
    if spec and isinstance(spec[0], list):
        arr = np.asarray(spec, dtype=float)
        return arr[:, 0], arr[:, 1], "pairs"
    levels = np.asarray(spec, dtype=float)
    bins = int(row["bins"])
    freqs = np.arange(len(levels), dtype=float) * float(row["bandwidth"]) / (bins - 1)
    return freqs, levels, "flat"


def idx_at(freqs: Curve, hz: float) -> int:
    """Return the bin index nearest a frequency."""
    return int(np.clip(np.abs(freqs - hz).argmin(), 0, len(freqs) - 1))


def prepared(row: Row) -> tuple[Curve, Curve, Curve, Curve, float, str]:
    """Return frequencies, raw levels, spur baseline, working curve, floor and format."""
    freqs, levels, fmt = curve(row)
    freqs, levels = freqs[:-DROP_TOP_BINS], levels[:-DROP_TOP_BINS]
    smoothed = median_smooth(levels, SMOOTH_BINS)
    baseline = median_smooth(levels, SPUR_BASELINE_BINS)
    return freqs, levels, baseline, smoothed, percentile_floor(smoothed), fmt


def shape_cliff(freqs: Curve, smoothed: Curve, floor: float, contrast: float) -> tuple[float, ...]:
    """Return (ceiling_hz, depth, above_rel, ref_rel, edge_rel) inside the 20-26 kHz window."""
    ref = band_mean(smoothed, idx_at(freqs, CLIFF_REF_HZ[0]), idx_at(freqs, CLIFF_REF_HZ[1]))
    bottom, top = (idx_at(freqs, h) for h in CLIFF_WINDOW_HZ)
    edge = -1
    for i in range(bottom, top + 1):
        if smoothed[i] > floor + contrast:
            edge = i
    if edge <= bottom or edge >= top:
        return 0.0, 0.0, 0.0, ref - floor, 0.0
    guard = max(1, round(CLIFF_GUARD_HZ / float(freqs[1] - freqs[0])))
    above = band_median(smoothed, min(len(smoothed) - 1, edge + guard), len(smoothed) - 1)
    return float(freqs[edge]), ref - above, above - floor, ref - floor, float(smoothed[edge]) - floor


def free_edge(freqs: Curve, smoothed: Curve, floor: float, contrast: float) -> float:
    """Return the highest bin standing clear of the floor. No window, and no class reads it."""
    clear = np.nonzero(smoothed > floor + contrast)[0]
    return float(freqs[clear[-1]]) if len(clear) else 0.0


def shape_spur(freqs: Curve, levels: Curve, baseline: Curve, floor: float, contrast: float) -> tuple[float, float]:
    """Return the best excess over the baseline above 25 kHz, and the bin that carried it."""
    lo = idx_at(freqs, SPUR_MIN_HZ)
    if lo >= len(freqs) - 1:
        return 0.0, 0.0
    excess = np.where(levels[lo:] > floor + contrast, levels[lo:] - baseline[lo:], -np.inf)
    j = int(excess.argmax())
    if not np.isfinite(excess[j]) or excess[j] <= 0:
        return 0.0, 0.0
    return float(excess[j]), float(freqs[lo + j])


def shape_ramp(freqs: Curve, smoothed: Curve, floor: float, samplerate: int) -> tuple[float, float]:
    """Return the dB/kHz slope from 25 kHz up and the top band's level over the floor."""
    if samplerate < RAMP_MIN_RATE:
        return 0.0, 0.0
    lo = idx_at(freqs, RAMP_LO_HZ)
    if lo >= len(freqs) - 2:
        return 0.0, 0.0
    slope = float(np.polyfit(freqs[lo:] / 1000.0, smoothed[lo:], 1)[0])
    top_lo = idx_at(freqs, RAMP_TOP_FRAC * float(freqs[-1]))
    return slope, band_mean(smoothed, top_lo, len(smoothed) - 1) - floor


def capture_files(inbox: Path) -> list[Path]:
    """Return every capture in an inbox; the `.orig` sidecars fall outside the glob."""
    return sorted(inbox.glob("junkcal-*.jsonl"))


def file_rows(path: Path) -> list[Row]:
    """Return every row of one capture, nulls included."""
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def trough(counts: dict[int, int], lo: int, hi: int) -> float:
    """Return the first local minimum above the floor mode, not the smallest bin in range."""
    for b in range(lo + 1, hi):
        here = counts.get(b, 0)
        if here <= counts.get(b - 1, 0) and here < counts.get(b + 1, 0):
            return float(b)
    return float(lo)


def score_row(row: Row, stamp: str, line: int, contrast: float) -> Score:
    """Return every shape statistic of one row, at the contrast the corpus settled."""
    freqs, levels, baseline, smoothed, floor, fmt = prepared(row)
    sr = int(row["samplerate"])
    ceiling, depth, above_rel, ref_rel, edge_rel = shape_cliff(freqs, smoothed, floor, contrast)
    spur, spur_hz = shape_spur(freqs, levels, baseline, floor, contrast)
    slope, top_rel = shape_ramp(freqs, smoothed, floor, sr)
    return {
        "stamp": stamp,
        "line": line,
        "ts": row["timestamp"],
        "fmt": fmt,
        "sr": sr,
        "floor": round(floor, 2),
        "ref_rel": round(ref_rel, 2),
        "ceiling_hz": round(ceiling, 1),
        "edge_rel": round(edge_rel, 2),
        "depth": round(depth, 2),
        "above_rel": round(above_rel, 2),
        "free_edge_hz": round(free_edge(freqs, smoothed, floor, contrast), 1),
        "spur": round(spur, 2),
        "spur_hz": round(spur_hz, 1),
        "slope": round(slope, 4),
        "top_rel": round(top_rel, 2),
        "step_hz": round(float(freqs[1] - freqs[0]), 4),
        "rows": 0,
    }


def contrast_of(files: list[Path]) -> float:
    """Return the contrast split, accumulated over the corpus with no contrast value in hand."""
    hist: dict[int, int] = {}
    for path in files:
        for row in file_rows(path):
            if row.get("spectrum") is None:
                continue
            _f, _l, _b, smoothed, floor, _fmt = prepared(row)
            for v in np.floor(smoothed - floor).astype(int):
                hist[int(v)] = hist.get(int(v), 0) + 1
    return trough(hist, 2, 20)


def do_shape(inbox: Path, scores_path: Path, only: str | None = None) -> None:
    """Score every row of every capture in an inbox, and write one record per scored row.

    ``only`` names one capture stamp. A single capture cannot measure the corpus contrast, so
    the pass scores at the recorded reading and the album it yields joins one already built.
    """
    if only is not None:
        files = [inbox / f"junkcal-{only}.jsonl"]
        contrast = CONTRAST_DB
    else:
        files = capture_files(inbox)
        contrast = contrast_of(files)
    if contrast != CONTRAST_DB:
        # Another inbox, or this one changed under the recorded reading. Neither is an error;
        # the pass scores at what it measured and says so.
        print(f"contrast {contrast} measured here, against {CONTRAST_DB} recorded")
    total = nulls = 0
    with scores_path.open("w", encoding="utf-8") as out:
        for path in files:
            stamp = path.name[len("junkcal-") : -len(".jsonl")]
            rows = file_rows(path)
            for line, row in enumerate(rows):
                total += 1
                if row.get("spectrum") is None:
                    nulls += 1
                    continue
                rec = score_row(row, stamp, line, contrast)
                rec["rows"] = len(rows)
                out.write(json.dumps(rec) + "\n")
    print(f"files={len(files)} rows={total} nulls={nulls} contrast={contrast} out={scores_path}")


def ramp_pos(r: Score) -> bool:
    """Report whether a row's content rises into its top band."""
    return bool(r["sr"] >= RAMP_MIN_RATE and r["slope"] > 0.0 and r["top_rel"] >= RAMP_TOP_SPLIT_DB)


def cliff_pos(r: Score) -> bool:
    """Report whether a row carries a band edge. Ramp wins: content to Nyquist has no edge."""
    if ramp_pos(r):
        return False
    return bool(r["depth"] >= CLIFF_SPLIT_DB if r["fmt"] == "flat" else r["ceiling_hz"] > 0.0)


def spur_pos(r: Score) -> bool:
    """Report whether a row carries a spur over the baseline."""
    return bool(r["spur"] >= SPUR_SPLIT_DB)


def sig(r: Score) -> str:
    """Return a row's one signature, by the precedence ramp, cliff, spur, clean."""
    if ramp_pos(r):
        return "ramp"
    if cliff_pos(r):
        return "cliff"
    return "spur" if spur_pos(r) else "clean"


def plurality(sigs: list[str]) -> str:
    """Return the majority signature of a run of rows, a tie going to the same precedence."""
    counts = {k: sigs.count(k) for k in ("ramp", "cliff", "spur", "clean")}
    best = max(counts.values())
    return next(k for k in ("ramp", "cliff", "spur", "clean") if counts[k] == best)


def content_runs(marks: list[bool]) -> list[tuple[int, int]]:
    """Return runs of content, bridging neutral stretches under GAP, MIN_RUN positives to stand."""
    idx = [i for i, m in enumerate(marks) if m]
    if not idx:
        return []
    groups = [[idx[0], idx[0]]]
    for i in idx[1:]:
        if i - groups[-1][1] - 1 < GAP:
            groups[-1][1] = i
        else:
            groups.append([i, i])
    # MIN_RUN counts positives, never the span the bridging produced: three positives spread
    # over six rows carry three, not six, and stray positives stay where they lie.
    whole = len(idx) == len(marks)
    counts = [sum(1 for i in range(lo, hi + 1) if marks[i]) for lo, hi in groups]
    return [(lo, hi + 1) for (lo, hi), n in zip(groups, counts, strict=True) if n >= MIN_RUN or whole]


def relines(pieces: list[dict[str, Any]], recs: list[Score], total: int) -> None:
    """Set each piece's source-line span, the first piece owning the head and the last the tail."""
    for i, p in enumerate(pieces):
        p["line_lo"] = 0 if i == 0 else recs[p["lo"]]["line"]
        p["line_hi"] = total if i == len(pieces) - 1 else recs[pieces[i + 1]["lo"]]["line"]
        p["rows"] = p["line_hi"] - p["line_lo"]


def first_short(pieces: list[dict[str, Any]]) -> int:
    """Return the index of the first piece under the row floor, or -1 when none is."""
    return next((i for i, p in enumerate(pieces) if p["rows"] < MIN_ROWS), -1)


def apply_min_rows(pieces: list[dict[str, Any]], recs: list[Score], total: int) -> None:
    """Give a short album rows from a neighbour that can spare them, else merge it into one."""
    relines(pieces, recs, total)
    i = first_short(pieces)
    while i >= 0 and len(pieces) > 1:
        p = pieces[i]
        nxt = pieces[i + 1] if i + 1 < len(pieces) else None
        prv = pieces[i - 1] if i > 0 else None
        donors = [
            (d, s) for d, s in ((nxt, 1), (prv, -1)) if d is not None and d["rows"] > MIN_ROWS and d["hi"] - d["lo"] > 1
        ]
        if donors:
            donor, side = donors[0]
            take = min(MIN_ROWS - p["rows"], donor["hi"] - donor["lo"] - 1)
            p["hi" if side > 0 else "lo"] += take * side
            donor["lo" if side > 0 else "hi"] += take * side
        else:
            target = nxt if nxt is not None else pieces[i - 1]
            target["lo"] = min(target["lo"], p["lo"])
            target["hi"] = max(target["hi"], p["hi"])
            pieces.pop(i)
        relines(pieces, recs, total)
        i = first_short(pieces)


def pieces_of(recs: list[Score], stamp: str, total: int) -> list[dict[str, Any]]:
    """Cut one capture into albums: content runs, forced material cuts, then the row floor."""
    sigs = [sig(r) for r in recs]
    starts = {0}
    for lo, hi in content_runs([s in ("cliff", "ramp") for s in sigs]):
        starts.add(lo)
        if hi < len(recs):
            starts.add(hi)
    forced = set(FORCE_CUTS.get(stamp, []))
    starts.update(i for i, r in enumerate(recs) if r["line"] in forced)
    bounds = [*sorted(starts), len(recs)]
    pieces: list[dict[str, Any]] = [{"lo": a, "hi": b} for a, b in pairwise(bounds) if b > a]
    apply_min_rows(pieces, recs, total)
    for p in pieces:
        p["sigs"] = sigs[p["lo"] : p["hi"]]
        p["class"] = plurality(p["sigs"])
    return [p for p in pieces if p["rows"] >= MIN_ROWS]


def rounded(row: Row) -> Row:
    """Return a capture row with its levels at 0.1 dB, every other field untouched."""
    spec = row["spectrum"]
    if spec and isinstance(spec[0], list):
        return dict(row, spectrum=[[p[0], round(float(p[1]), 1)] for p in spec])
    return dict(row, spectrum=[round(float(v), 1) for v in spec])


def excess_at(row: Row, hz: float) -> float:
    """Return one row's excess over its baseline at one bin."""
    freqs, levels, baseline, _s, _f, _fmt = prepared(row)
    i = idx_at(freqs, hz)
    return round(float(levels[i] - baseline[i]), 2)


def near_miss_ratio(r: Score) -> float:
    """Return how near a row comes to any boundary, the ratio of its best statistic to it."""
    best = float(r["spur"]) / SPUR_SPLIT_DB
    if r["fmt"] == "flat" and r["depth"] > 0:
        best = max(best, float(r["depth"]) / CLIFF_SPLIT_DB)
    if r["sr"] >= RAMP_MIN_RATE and r["slope"] > 0:
        best = max(best, float(r["top_rel"]) / RAMP_TOP_SPLIT_DB)
    return round(best, 3)


def stats_of(r: Score) -> dict[str, float]:
    """Return the statistics a kept row carries into labels.json."""
    keys = ("floor", "ceiling_hz", "edge_rel", "free_edge_hz", "depth", "spur", "spur_hz")
    out = {k: float(r[k]) for k in keys}
    if r["sr"] >= RAMP_MIN_RATE:
        out.update(slope=float(r["slope"]), top_rel=float(r["top_rel"]))
    return out


def dominant_spur(rows: list[Score], step_hz: float) -> tuple[float, int]:
    """Return the bin most of an album's spur-bearing rows agree on, and how many agree."""
    tol = SPUR_TOL_BINS * step_hz
    pos = [r for r in rows if spur_pos(r)]
    best, best_n = 0.0, 0
    for cand in pos:
        n = sum(1 for r in pos if abs(r["spur_hz"] - cand["spur_hz"]) <= tol)
        if n > best_n:
            best, best_n = cand["spur_hz"], n
    return best, best_n


class Album:
    """One album: its rows, its class, and the roles that decide what the fixture keeps."""

    def __init__(self, rows: list[Score], klass: str, raw: dict[str, Row], step_hz: float) -> None:
        """Take an album's scored rows, its class, its source rows and its bin width."""
        self.rows = rows
        self.klass = klass
        self.raw = raw
        self.stamp = datetime.fromisoformat(rows[0]["ts"]).strftime("%Y%m%dT%H%M%SZ")
        self.label_only = klass == "cliff" and rows[0]["fmt"] == "pairs"
        self.roles: dict[str, list[str]] = {}
        self.extra: dict[str, dict[str, float]] = {}
        self.notes: list[str] = []
        self.dom_hz, dom_n = dominant_spur(rows, step_hz)
        self.carries_spur = self.dom_hz > 0.0 and dom_n >= len(rows) / 2

    def give(self, rec: Score | None, role: str) -> None:
        """Give one row a role, roles deduplicating when one row earns several."""
        if rec is not None and role not in self.roles.get(rec["ts"], []):
            self.roles.setdefault(rec["ts"], []).append(role)

    def signature_roles(self) -> None:
        """Keep the first row, the album's own extremes, and one row of the losing signature.

        A pair cliff album is label_only: its depth is the capture's stored silence rather than
        a transition, so it keeps a presence row and no magnitude row.
        """
        cliffs = [r for r in self.rows if cliff_pos(r)]
        ramps = [r for r in self.rows if ramp_pos(r)]
        self.give(self.rows[0], "first")
        if self.klass == "cliff" and self.label_only:
            self.give(max(cliffs, key=lambda r: r["edge_rel"]), "cliff")
        elif self.klass == "cliff":
            self.give(max(cliffs, key=lambda r: r["depth"]), "strongest")
            self.give(min(cliffs, key=lambda r: r["depth"]), "weakest")
        elif self.klass == "ramp":
            self.give(max(ramps, key=lambda r: r["slope"]), "strongest")
            self.give(min(ramps, key=lambda r: r["slope"]), "weakest")
        if self.klass == "cliff" and ramps and not self.label_only:
            self.give(max(ramps, key=lambda r: r["slope"]), "ramp")
        if self.klass == "ramp" and cliffs:
            self.give(max(cliffs, key=lambda r: r["edge_rel"]), "cliff")

    def spur_roles(self) -> None:
        """Keep the strongest and weakest spur row, and the row where that bin has gone quiet."""
        if not self.carries_spur or self.label_only:
            return
        at = {r["ts"]: excess_at(self.raw[r["ts"]], self.dom_hz) for r in self.rows}
        hot = [r for r in self.rows if at[r["ts"]] >= SPUR_SPLIT_DB]
        if not hot:
            return
        strongest = max(hot, key=lambda r: at[r["ts"]])
        self.give(strongest, "strongest" if self.klass == "spur" else "spur")
        if self.klass == "spur":
            self.give(min(hot, key=lambda r: at[r["ts"]]), "weakest")
        quiet = min(self.rows, key=lambda r: at[r["ts"]])
        drop = round(at[strongest["ts"]] - at[quiet["ts"]], 2)
        if drop >= DROP_DB:
            self.give(quiet, "spur-absent")
        else:
            self.notes.append(f"{self.stamp}: no spur-absent row, best drop {drop} dB")
        for r in self.rows:
            if r["ts"] in self.roles:
                self.extra.setdefault(r["ts"], {})["dom_excess"] = at[r["ts"]]
                self.extra[r["ts"]]["dom_spur_hz"] = round(self.dom_hz, 1)

    def lossy_sub_case(self) -> None:
        """Excise the cliff class where content has already stopped below 20 kHz.

        A 20k filter does nothing for lossy material, so such an album is clean with no filter.
        A row carrying no free edge at all counts toward neither side: silence is evidence of
        nothing, and reading it as "below 20 kHz" would make any quiet stretch lossy.
        """
        eligible = [r for r in self.rows if r["free_edge_hz"] > 0.0]
        sub20 = [r for r in eligible if r["ceiling_hz"] == 0.0 and r["free_edge_hz"] < SUB20_HZ]
        if eligible and len(sub20) >= LOSSY_FRACTION * len(eligible) and self.klass == "cliff":
            self.notes.append(f"{self.stamp}: lossy sub-case, {len(sub20)}/{len(eligible)} rows below 20 kHz")
            self.klass, self.label_only = "clean", False

    def near_miss(self) -> None:
        """Keep a clean album's most dangerous row, and record how near it came."""
        if self.klass != "clean":
            return
        row = max(self.rows, key=near_miss_ratio)
        self.give(row, "near-miss")
        self.extra.setdefault(row["ts"], {})["near_miss_ratio"] = near_miss_ratio(row)

    def junk_filter(self) -> str:
        """Return the filter this album implies, the corner following the shipped split."""
        fixed = {"cliff": "20k", "ramp": "50k", "clean": "none"}
        return fixed.get(self.klass, "40k" if self.dom_hz > SPUR_CORNER_SPLIT_HZ else "30k")

    def write(self, out_dir: Path) -> None:
        """Write this album's kept rows, levels at 0.1 dB, in file order."""
        path = out_dir / f"{self.stamp}.jsonl.gz"
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as gz:
            for r in self.rows:
                if r["ts"] in self.roles:
                    gz.write(json.dumps(rounded(self.raw[r["ts"]])) + "\n")

    def label(self, source: str, rows_on_disk: int) -> dict[str, Any]:
        """Return this album's labels.json entry, one row record per kept row."""
        keep = [r for r in self.rows if r["ts"] in self.roles]
        return {
            "source": source,
            "samplerate": self.rows[0]["sr"],
            "rows": rows_on_disk,
            "full_band": self.klass != "cliff",
            "class": self.klass,
            "junk_filter": self.junk_filter(),
            "label_only": self.label_only,
            "kept": [
                {
                    "timestamp": r["ts"],
                    "roles": self.roles[r["ts"]],
                    "stats": {**stats_of(r), **self.extra.get(r["ts"], {})},
                }
                for r in keep
            ],
        }


def load_scores(scores_path: Path) -> dict[str, list[Score]]:
    """Return every score record, grouped by capture stamp and left in file order."""
    by_stamp: dict[str, list[Score]] = {}
    with scores_path.open(encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            by_stamp.setdefault(rec["stamp"], []).append(rec)
    return by_stamp


def do_emit(inbox: Path, scores_path: Path, out_dir: Path, only: str | None = None) -> None:
    """Cut, class and write the whole corpus, replacing whatever the fixture directory held.

    ``only`` names one capture stamp: the fixture directory is kept, that capture's albums are
    added to the labels already there, and no album built before is re-emitted or relabelled.
    """
    by_stamp = load_scores(scores_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    labels: dict[str, Any] = {}
    if only is not None:
        by_stamp = {only: by_stamp[only]}
        with (out_dir / "labels.json").open(encoding="utf-8") as fh:
            labels = json.load(fh)
    else:
        for old in sorted(out_dir.iterdir()):
            old.unlink()
    tally: dict[str, int] = {}
    notes: list[str] = []
    for stamp, recs in sorted(by_stamp.items()):
        if stamp in STRUCK:
            notes.append(f"{stamp}: struck, {STRUCK[stamp]}")
            continue
        source = f"junkcal-{stamp}.jsonl"
        raw = {row["timestamp"]: row for row in file_rows(inbox / source) if row.get("spectrum") is not None}
        for p in pieces_of(recs, stamp, int(recs[0]["rows"])):
            album = Album(recs[p["lo"] : p["hi"]], p["class"], raw, float(recs[0]["step_hz"]))
            album.signature_roles()
            album.spur_roles()
            album.lossy_sub_case()
            album.near_miss()
            album.write(out_dir)
            labels[album.stamp] = album.label(source, int(p["rows"]))
            tally[album.klass] = tally.get(album.klass, 0) + 1
            notes.extend(album.notes)
    with (out_dir / "labels.json").open("w", encoding="utf-8") as fh:
        json.dump(labels, fh, indent=1, sort_keys=True)
    print("\n".join(notes))
    print(f"albums={len(labels)} tally={json.dumps(tally, sort_keys=True)} out={out_dir}")


def main() -> None:
    """Run one pass over an inbox, shape or emit."""
    work = Path(os.environ.get("CLAUDE_SCRATCH", tempfile.gettempdir()))
    ap = argparse.ArgumentParser(description="junkcal fixture corpus")
    ap.add_argument("mode", choices=("shape", "emit"))
    ap.add_argument("--inbox", type=Path, default=SRC, help="capture directory")
    ap.add_argument("--out", type=Path, default=OUT, help="fixture directory to rewrite")
    ap.add_argument(
        "--scores",
        type=Path,
        default=work / "junkcal-scores.jsonl",
        help="where shape writes its records and emit reads them",
    )
    ap.add_argument("--only", help="one capture stamp: score it at the recorded contrast, add its albums")
    args = ap.parse_args()
    if args.mode == "shape":
        do_shape(args.inbox, args.scores, args.only)
    else:
        do_emit(args.inbox, args.scores, args.out, args.only)


if __name__ == "__main__":
    main()
