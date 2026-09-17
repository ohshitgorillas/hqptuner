#!/usr/bin/env python3
"""Attribute every wrong tick in the junkcal replay to the rule outcome that produced it.

``scripts/junkcal_seq.py`` says how many ticks disagree with their album label and how many writes
auto-pilot would make; it does not say why. This script replays the same corpus the same way: the
files ``manifest.json`` lists, each graded against its own album label and a gap file graded not at
all, one ``SpurHolder`` carried across rows and reset only where ``seconds`` goes backwards. It
records, for
every tick, what each of the three rules did and what the verdict became after the main filter was
taken into account. A wrong tick is then a named rule outcome rather than a count.

Recorded per tick: the cliff rule's edge outcome (no bin in the window clear of ``floor +
CONTRAST_DB``, an edge pinned at the bottom of ``CLIFF_WINDOW_HZ``, an edge pinned at the top, a
depth short of ``CLIFF_SPLIT_DB``, or a fire with its depth and ceiling); the spur rule's held set
with the strongest held excess, or the strongest visible excess where nothing is held; the ramp
rule's rank against ``RAMP_RANK``; and whether the engaged main filter masked the verdict inside
``autopilot.desired_junk_filter``, which turns a verdict into a ``none`` write with no rule at fault.

The histograms are printed over all wrong ticks and over the writes, split by label and by the
filter auto-pilot wanted, so a loss shows up as a window bound, a split shortfall, a missing hold or
a mask rather than as a total. The corpus is read, never written.
"""

from __future__ import annotations

import argparse
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import junkcal_seq as seq

from hqptuner.engine import junkadvisor
from hqptuner.engine.junkadvisor import (
    _CORNER_KHZ,
    _band_mean,
    _band_median,
    _Curve,
    _excesses,
    _median_smooth,
    _rank_correlation,
    _spur_corner,
)
from hqptuner.lanes import autopilot

Row = dict[str, Any]

#: Width of the dB buckets the depth and excess shortfalls are histogrammed in.
DEPTH_BUCKET_DB = 5.0
EXCESS_BUCKET_DB = 4.0

#: Composite rows printed per section before the tail is elided.
SHOWN_COMPOSITES = 12


@dataclass(frozen=True)
class Probe:
    """One tick's rule outcomes, the verdict they produced, and the filter auto-pilot would write."""

    cliff: str
    spur: str
    ramp: str
    mask: str
    verdict: str
    want: str
    label: str | None
    capture: str
    seconds: float


def bucket(value: float, width: float) -> str:
    """Return the half-open dB bucket a value falls in, named by its ends."""
    lo = math.floor(value / width) * width
    return f"[{lo:g},{lo + width:g})"


def cliff_probe(curve: _Curve) -> str:
    """Return the cliff rule's outcome on one curve as a named code.

    The edge search is ``_content_edge`` unrolled, because that function collapses three different
    refusals into one ``None`` and the three are the whole question here.
    """
    bottom, top = (curve.at(h) for h in junkadvisor.CLIFF_WINDOW_HZ)
    limit = curve.floor + junkadvisor.CONTRAST_DB
    edge = -1
    for i in range(bottom, top + 1):
        if curve.smoothed[i] > limit:
            edge = i
    if edge < 0:
        return "no_bin_clear"
    if edge <= bottom:
        return "edge_at_bottom"
    if edge >= top:
        return "edge_at_top"
    kept = len(curve.levels)
    guard = max(1, round(junkadvisor.CLIFF_GUARD_HZ * (curve.bins - 1) / curve.bandwidth))
    above = _band_median(curve.smoothed, min(kept - 1, edge + guard), kept - 1)
    ref = _band_mean(curve.smoothed, curve.at(junkadvisor.CLIFF_REF_HZ[0]), curve.at(junkadvisor.CLIFF_REF_HZ[1]))
    depth = ref - above
    if depth < junkadvisor.CLIFF_SPLIT_DB:
        return f"split_short d={bucket(depth, DEPTH_BUCKET_DB)}"
    return f"fires d={bucket(depth, DEPTH_BUCKET_DB)} ceil={curve.hz(edge) / 1000:.0f}k"


def spur_probe(curve: _Curve, holder: junkadvisor.SpurHolder) -> str:
    """Return the spur rule's outcome, advancing the holder exactly as ``_spur`` does."""
    visible = _excesses(curve)
    held = holder.decide(visible)
    if held:
        corner = min((_spur_corner(f) for f in held), key=lambda n: _CORNER_KHZ[n])
        best = max(visible[f] for f in held) if any(f in visible for f in held) else float("nan")
        return f"held n={len(held)} {corner} x={bucket(best, EXCESS_BUCKET_DB)}"
    if not visible:
        return "no_visible_bin"
    return f"not_held x={bucket(max(visible.values()), EXCESS_BUCKET_DB)}"


def ramp_probe(curve: _Curve, samplerate: int) -> str:
    """Return the ramp rule's outcome: its rank against the threshold, or why it could not be read."""
    if samplerate < junkadvisor.RAMP_MIN_RATE:
        return "rate_too_low"
    band = curve.smoothed[curve.above(junkadvisor.RAMP_LO_HZ) :]
    if len(band) < junkadvisor.SPUR_BASELINE_BINS:
        return "band_too_narrow"
    rank = _rank_correlation(_median_smooth(band, junkadvisor.SPUR_BASELINE_BINS))
    return f"{'fires' if rank >= junkadvisor.RAMP_RANK else 'flat'} r={rank:.3f}"


def probe(row: Row, holder: junkadvisor.SpurHolder, label: str | None, capture: str) -> Probe:
    """Return one row's rule outcomes, carrying the holder forward as the reader does."""
    levels = None if row.get("spectrum") is None else seq.full_curve(row)
    samplerate = int(row["samplerate"])
    bandwidth = float(row["bandwidth"])
    seconds = float(row["seconds"])
    if levels is None or not junkadvisor.eligible(samplerate, bandwidth, len(levels), sdm=bool(row.get("sdm", False))):
        return Probe("ineligible", "ineligible", "ineligible", "-", "-", junkadvisor.NO_FILTER, label, capture, seconds)
    curve = _Curve(levels, bandwidth)
    cliff = cliff_probe(curve)
    spur = spur_probe(curve, holder)
    ramp = ramp_probe(curve, samplerate)
    verdict = junkadvisor.classify(levels, bandwidth, samplerate=samplerate, sdm=False, holder=_replay_holder(holder))
    name = junkadvisor.NO_FILTER if verdict is None else str(verdict["filter"])
    want = autopilot.desired_junk_filter(verdict, row.get("filter"))
    mask = "masked_by_main" if verdict is not None and want != name else "-"
    return Probe(cliff, spur, ramp, mask, name, want, label, capture, seconds)


def _replay_holder(holder: junkadvisor.SpurHolder) -> junkadvisor.SpurHolder:
    """Return a holder carrying the same bins, so ``classify`` sees the state without advancing it twice.

    ``spur_probe`` has already run the holder over this window; running the shipped rule on the same
    holder would apply the release logic a second time. The copy is taken after that advance, so the
    rule reads the state the reader would have and the corpus holder stays the one the replay carries.
    """
    copy = junkadvisor.SpurHolder()
    copy.held = set(holder.held)
    return copy


def probes(rows: list[Row], label: str | None, capture: str) -> list[Probe]:
    """Probe one file's rows in order, resetting the holder where the stream breaks.

    ``label`` is the album label the whole file carries, or None for a gap file, whose ticks are
    probed and counted as writes and graded against nothing.
    """
    holder = junkadvisor.SpurHolder()
    previous: float | None = None
    out: list[Probe] = []
    for row in rows:
        seconds = float(row["seconds"])
        if previous is not None and seconds < previous:
            holder = junkadvisor.SpurHolder()
        previous = seconds
        out.append(probe(row, holder, label, capture))
    return out


def written(rows: list[Row], items: list[Probe]) -> list[Probe]:
    """Return the probes at the ticks auto-pilot would write, from the filter engaged at row one."""
    engaged = str(rows[0].get("junk_filter") or junkadvisor.NO_FILTER) if rows else junkadvisor.NO_FILTER
    made: list[Probe] = []
    for item in items:
        if item.want != engaged:
            made.append(item)
            engaged = item.want
    return made


def histogram(title: str, items: list[Probe]) -> None:
    """Print the per-axis and composite histograms for one set of probes, split by label and want."""
    print(f"== {title}: {len(items)} ticks ==")
    for pair, group in sorted(by_pair(items).items(), key=lambda kv: -len(kv[1])):
        print(f"-- label={pair[0]} want={pair[1]}: {len(group)} ticks")
        for axis in ("cliff", "spur", "ramp"):
            counts = Counter(str(getattr(item, axis)) for item in group).most_common(6)
            print(f"   {axis:6} " + "  ".join(f"{name}={count}" for name, count in counts))
        masked = sum(1 for item in group if item.mask != "-")
        print(f"   masked_by_main={masked}  captures={len({item.capture for item in group})}")
        composites = Counter(f"{item.cliff} | {item.spur} | {item.ramp}" for item in group)
        for name, count in composites.most_common(SHOWN_COMPOSITES):
            print(f"     {count:5}  {name}")
        if len(composites) > SHOWN_COMPOSITES:
            print(f"     ... (+{len(composites) - SHOWN_COMPOSITES} composites)")
    print()


def by_pair(items: list[Probe]) -> dict[tuple[str, str], list[Probe]]:
    """Group probes by the label in force and the filter auto-pilot wanted."""
    groups: dict[tuple[str, str], list[Probe]] = {}
    for item in items:
        groups.setdefault((item.label or "-", item.want), []).append(item)
    return groups


def main() -> None:
    """Replay the capture corpus, attribute every wrong tick and every write, and print the histograms."""
    ap = argparse.ArgumentParser(description="attribute junkcal replay errors to rule outcomes")
    ap.add_argument("--captures", type=Path, default=seq.CAPTURES, help="directory holding manifest.json and its files")
    args = ap.parse_args()

    every: list[Probe] = []
    writes: list[Probe] = []
    for name, path, label in seq.sequences(args.captures):
        rows = seq.capture_rows(path)
        if not rows:
            continue
        items = probes(rows, label, name)
        every.extend(items)
        writes.extend(written(rows, items))

    wrong = [item for item in every if item.label is not None and item.want != item.label]
    labelled = sum(1 for item in every if item.label is not None)
    print(f"corpus: ticks={len(every)} labelled={labelled} wrong={len(wrong)} writes={len(writes)}")
    print()
    histogram("wrong ticks", wrong)
    histogram("writes", writes)


if __name__ == "__main__":
    main()
