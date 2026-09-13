#!/usr/bin/env python3
"""Read junkcal capture files and show the stored spectra directly.

The captures hold the detector's input, one row per tick: the engine context, the aggregate's coverage and grid, and
the windowed minimum spectrum from the lossy window's floor upward. The recorded ``verdict`` is the current rules'
output, not ground truth; this tool reports it as one column among many and otherwise ignores it.

One limit is structural and worth knowing before reading anything here: the row stores the windowed *minimum*
spectrum only. ``junkadvisor``'s brick-wall and ramp rules read the *mean* spectrum, which is not captured, so a
recorded 20k or 50k verdict cannot be recomputed from the row that carries it. Only the spur rule's input is here.

Three subcommands:

``rows``   one line per row, with the engine context and the recorded verdict.
``curve``  one row's stored curve, as an ASCII plot or as ``hz,db`` pairs.
``band``   band statistics over one row or every row, one line each, for any band and any statistic named below;
           ``--summary`` instead groups the selected rows by their recorded verdict and prints each statistic's
           10th, 50th and 90th percentile per group, which is how a candidate threshold's separation is read.

Frequencies accept ``25k``, ``25.5k`` or ``25500``. Bands are ``LO:HI`` with either side open: ``:26k``, ``40k:``.

Statistics: count mean median min max p10 p90 argmax_hz slope_db_per_khz slope_db_per_oct excess_db excess_hz
edge_hz floor. ``excess_*`` is the peak of curve-minus-wide-median inside the band, the spur statistic. ``edge_hz``
is the highest frequency in the band standing ``--above`` dB clear of the floor, the content-ceiling statistic.
``floor`` is the low percentile of the whole stored curve, the reference the other two are measured against.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_DIR = Path("/srv/hqptuner/state/junkcal")
FLOOR_PERCENTILE = 10
DEFAULT_ABOVE_DB = 8.0
DEFAULT_BASELINE_BINS = 51
DEFAULT_STATS = ("count", "mean", "median", "max", "argmax_hz", "slope_db_per_khz", "excess_db", "excess_hz")
PLOT_COLS = 100
PLOT_LINES = 24
MIN_FIT_POINTS = 2


@dataclass(frozen=True)
class Row:
    """One capture row: where it came from, its engine context, and its stored curve."""

    index: int
    source: str
    line: int
    data: dict[str, Any]

    @property
    def curve(self) -> tuple[list[float], list[float]]:
        """Return the stored spectrum as parallel frequency and level lists, empty when the row carries none."""
        spectrum = self.data.get("spectrum")
        if not spectrum:
            return [], []
        return [float(p[0]) for p in spectrum], [float(p[1]) for p in spectrum]

    @property
    def verdict_label(self) -> str:
        """Return a short label for the recorded verdict: its filter and ceiling, or ``-`` when none was latched."""
        verdict = self.data.get("verdict")
        if not verdict:
            return "-"
        return f"{verdict.get('filter')}@{verdict.get('ceiling_khz')}k"


def load_rows(paths: list[Path]) -> list[Row]:
    """Return every row in ``paths``, in file order then line order, numbered from zero across the whole set."""
    rows: list[Row] = []
    for path in sorted(paths):
        with path.open(encoding="utf-8") as handle:
            for lineno, raw in enumerate(handle, start=1):
                text = raw.strip()
                if not text:
                    continue
                rows.append(Row(len(rows), path.name, lineno, json.loads(text)))
    return rows


def capture_files(directory: Path) -> list[Path]:
    """Return the capture files in ``directory``, excluding the ``.orig`` sidecars."""
    return sorted(p for p in directory.glob("*.jsonl") if p.suffix == ".jsonl")


def parse_hz(text: str) -> float:
    """Return a frequency in Hz from ``25k``, ``25.5k`` or ``25500``."""
    text = text.strip().lower()
    if text.endswith("k"):
        return float(text[:-1]) * 1000.0
    return float(text)


def parse_band(text: str) -> tuple[float, float]:
    """Return ``(lo, hz)`` from ``LO:HI``, either side open, defaulting to the whole curve."""
    if ":" not in text:
        raise ValueError(f"band must be LO:HI, got {text!r}")
    lo_text, hi_text = text.split(":", 1)
    lo = parse_hz(lo_text) if lo_text.strip() else 0.0
    hi = parse_hz(hi_text) if hi_text.strip() else math.inf
    return lo, hi


def median_smooth(levels: list[float], width: int) -> list[float]:
    """Return ``levels`` under a median filter of ``width`` bins; width 1 returns the curve unchanged."""
    if width <= 1:
        return list(levels)
    half = width // 2
    n = len(levels)
    return [statistics.median(levels[max(0, i - half) : min(n, i + half + 1)]) for i in range(n)]


def percentile(levels: list[float], pct: int) -> float:
    """Return the ``pct`` percentile of ``levels`` by the same rank rule the detector uses."""
    ordered = sorted(levels)
    return ordered[min(len(ordered) - 1, (len(ordered) * pct) // 100)]


def slice_band(freqs: list[float], levels: list[float], band: tuple[float, float]) -> tuple[list[float], list[float]]:
    """Return the parts of ``freqs`` and ``levels`` whose frequency lies inside ``band``, endpoints included."""
    lo, hi = band
    kept = [(f, d) for f, d in zip(freqs, levels, strict=True) if lo <= f <= hi]
    return [f for f, _ in kept], [d for _, d in kept]


def _slope_per_hz(freqs: list[float], levels: list[float]) -> float:
    """Return the least-squares slope of ``levels`` against ``freqs``, in dB per Hz."""
    n = len(freqs)
    if n < MIN_FIT_POINTS:
        return math.nan
    mean_f = sum(freqs) / n
    mean_d = sum(levels) / n
    denom = sum((f - mean_f) ** 2 for f in freqs)
    if denom == 0.0:
        return math.nan
    return sum((f - mean_f) * (d - mean_d) for f, d in zip(freqs, levels, strict=True)) / denom


def _slope_per_octave(freqs: list[float], levels: list[float]) -> float:
    """Return the least-squares slope of ``levels`` against log2 frequency, in dB per octave."""
    usable = [(math.log2(f), d) for f, d in zip(freqs, levels, strict=True) if f > 0.0]
    if len(usable) < MIN_FIT_POINTS:
        return math.nan
    return _slope_per_hz([f for f, _ in usable], [d for _, d in usable])


def _excess(freqs: list[float], levels: list[float], baseline_bins: int) -> tuple[float, float]:
    """Return the largest ``level - wide median baseline`` in the band and the frequency it sits at."""
    if not levels:
        return math.nan, math.nan
    baseline = median_smooth(levels, baseline_bins)
    pairs = [(d - b, f) for d, b, f in zip(levels, baseline, freqs, strict=True)]
    return max(pairs)


def _edge_hz(freqs: list[float], levels: list[float], limit: float) -> float:
    """Return the highest frequency in the band whose level exceeds ``limit``, or NaN when none does."""
    above = [f for f, d in zip(freqs, levels, strict=True) if d > limit]
    return above[-1] if above else math.nan


def band_stats(row: Row, band: tuple[float, float], opts: argparse.Namespace) -> dict[str, float]:
    """Return every statistic this tool knows, computed over ``band`` of ``row``'s stored curve."""
    freqs, levels = row.curve
    if not freqs:
        return {}
    working = median_smooth(levels, opts.smooth)
    floor = percentile(median_smooth(levels, 9), FLOOR_PERCENTILE)
    band_freqs, band_levels = slice_band(freqs, working, band)
    if not band_freqs:
        return {"count": 0.0, "floor": floor}
    excess_db, excess_hz = _excess(band_freqs, band_levels, opts.baseline_bins)
    peak = max(band_levels)
    return {
        "count": float(len(band_levels)),
        "mean": sum(band_levels) / len(band_levels),
        "median": statistics.median(band_levels),
        "min": min(band_levels),
        "max": peak,
        "p10": percentile(band_levels, 10),
        "p90": percentile(band_levels, 90),
        "argmax_hz": band_freqs[band_levels.index(peak)],
        "slope_db_per_khz": _slope_per_hz(band_freqs, band_levels) * 1000.0,
        "slope_db_per_oct": _slope_per_octave(band_freqs, band_levels),
        "excess_db": excess_db,
        "excess_hz": excess_hz,
        "edge_hz": _edge_hz(band_freqs, band_levels, floor + opts.above),
        "floor": floor,
    }


def _matches(row: Row, opts: argparse.Namespace) -> bool:
    """Whether ``row`` passes the selection options shared by every subcommand."""
    if opts.rate is not None and row.data.get("samplerate") != opts.rate:
        return False
    if opts.file is not None and opts.file not in row.source:
        return False
    if opts.with_spectrum and not row.data.get("spectrum"):
        return False
    if opts.verdict is None:
        return True
    verdict = row.data.get("verdict")
    engaged = (verdict or {}).get("filter", "none")
    return str(engaged) == str(opts.verdict)


def select(rows: list[Row], opts: argparse.Namespace) -> list[Row]:
    """Return the rows passing the selection options, truncated to ``--limit`` where one is given."""
    kept = [row for row in rows if _matches(row, opts)]
    if opts.limit is not None:
        kept = kept[: opts.limit]
    return kept


def _fmt(value: float) -> str:
    """Return a fixed-width rendering of a statistic, with NaN shown as a dash."""
    if math.isnan(value):
        return f"{'-':>10}"
    return f"{value:10.2f}"


def cmd_rows(rows: list[Row], opts: argparse.Namespace) -> int:
    """Print one line per selected row: its index, source, context, coverage and recorded verdict."""
    print(f"{'idx':>5}  {'time':<19} {'rate':>7} {'sec':>7} {'pts':>5}  {'verdict':<12} {'junk':<5} filter")
    for row in select(rows, opts):
        data = row.data
        stamp = str(data.get("timestamp", ""))[:19]
        points = len(data.get("spectrum") or [])
        print(
            f"{row.index:>5}  {stamp:<19} {data.get('samplerate', 0):>7} {data.get('seconds', 0.0):>7.0f} "
            f"{points:>5}  {row.verdict_label:<12} {data.get('junk_filter')!s:<5} {data.get('filter')}"
        )
    return 0


def _plot(freqs: list[float], levels: list[float], cols: int, lines: int) -> list[str]:
    """Return an ASCII plot of ``levels`` against ``freqs``, one column per frequency bucket."""
    step = max(1, math.ceil(len(freqs) / cols))
    buckets = [max(levels[i : i + step]) for i in range(0, len(levels), step)]
    top, bottom = max(buckets), min(buckets)
    span = top - bottom or 1.0
    canvas = [[" "] * len(buckets) for _ in range(lines)]
    for col, value in enumerate(buckets):
        rank = int((top - value) / span * (lines - 1))
        canvas[rank][col] = "*"
    labels = [f"{top:8.1f}", *[" " * 8] * (lines - 2), f"{bottom:8.1f}"]
    return [f"{label} |{''.join(canvas[i])}" for i, label in enumerate(labels)]


def cmd_curve(rows: list[Row], opts: argparse.Namespace) -> int:
    """Print one row's stored curve, as an ASCII plot or as ``hz,db`` pairs."""
    row = rows[opts.index]
    freqs, levels = row.curve
    if not freqs:
        print(f"row {opts.index} carries no spectrum", file=sys.stderr)
        return 1
    band_freqs, band_levels = slice_band(freqs, median_smooth(levels, opts.smooth), parse_band(opts.band))
    if opts.dump:
        for f, d in zip(band_freqs, band_levels, strict=True):
            print(f"{f:.3f},{d:.4f}")
        return 0
    data = row.data
    print(
        f"row {row.index}  {row.source}:{row.line}  {data.get('samplerate')} Hz  "
        f"{data.get('seconds', 0.0):.0f} s  filter={data.get('filter')}  junk={data.get('junk_filter')}  "
        f"verdict={row.verdict_label}"
    )
    print(f"{band_freqs[0] / 1000:.2f} kHz .. {band_freqs[-1] / 1000:.2f} kHz, {len(band_freqs)} bins, dB")
    for line in _plot(band_freqs, band_levels, opts.cols, opts.lines):
        print(line)
    return 0


def _verdict_class(row: Row) -> str:
    """Return the recorded verdict's filter alone, the grouping key for a summary."""
    verdict = row.data.get("verdict")
    return str((verdict or {}).get("filter", "none"))


def _quantiles(values: list[float]) -> tuple[float, float, float]:
    """Return the 10th, 50th and 90th percentiles of ``values``."""
    usable = sorted(v for v in values if not math.isnan(v))
    if not usable:
        return math.nan, math.nan, math.nan
    return (percentile(usable, 10), statistics.median(usable), percentile(usable, 90))


def _summarize(chosen: list[Row], band: tuple[float, float], names: list[str], opts: argparse.Namespace) -> None:
    """Print, per recorded-verdict class, the count and the 10/50/90 percentiles of each named statistic."""
    grouped: dict[str, list[dict[str, float]]] = {}
    for row in chosen:
        stats = band_stats(row, band, opts)
        if stats:
            grouped.setdefault(_verdict_class(row), []).append(stats)
    print(f"{'class':<8} {'rows':>6} {'statistic':<18} {'p10':>10} {'p50':>10} {'p90':>10}")
    for name in sorted(grouped):
        bucket = grouped[name]
        for stat in names:
            p10, p50, p90 = _quantiles([s.get(stat, math.nan) for s in bucket])
            print(f"{name:<8} {len(bucket):>6} {stat:<18} {_fmt(p10)} {_fmt(p50)} {_fmt(p90)}")


def cmd_band(rows: list[Row], opts: argparse.Namespace) -> int:
    """Print the named statistics over the named band, one line per selected row or one block per verdict class."""
    band = parse_band(opts.band)
    names = [n.strip() for n in opts.stat.split(",") if n.strip()]
    chosen = rows if opts.index is None else [rows[opts.index]]
    if opts.index is None:
        chosen = select(chosen, opts)
    if opts.summary:
        _summarize(chosen, band, names, opts)
        return 0
    header = "".join(f"{n:>11}" for n in names)
    print(f"{'idx':>5} {'verdict':<12}{header}")
    for row in chosen:
        stats = band_stats(row, band, opts)
        if not stats:
            continue
        cells = "".join(f" {_fmt(stats.get(n, math.nan))}" for n in names)
        print(f"{row.index:>5} {row.verdict_label:<12}{cells}")
    return 0


def _add_selection(parser: argparse.ArgumentParser) -> None:
    """Add the row-selection options every subcommand shares."""
    parser.add_argument("--rate", type=int, help="keep only rows at this samplerate")
    parser.add_argument("--file", help="keep only rows whose capture file name contains this text")
    parser.add_argument("--verdict", help="keep only rows whose recorded verdict filter is this ('none' for null)")
    parser.add_argument("--limit", type=int, help="stop after this many rows")
    parser.add_argument("--with-spectrum", action="store_true", help="skip rows that carry no spectrum")


def _add_curve_opts(parser: argparse.ArgumentParser) -> None:
    """Add the options that shape how a curve is read."""
    parser.add_argument("--band", default=":", help="frequency band LO:HI, either side open")
    parser.add_argument("--smooth", type=int, default=1, help="median-filter width in bins (1 = raw)")


def build_parser() -> argparse.ArgumentParser:
    """Return the command-line parser for the three subcommands."""
    parser = argparse.ArgumentParser(description="Read junkcal captures and their stored spectra.")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="capture directory")
    subs = parser.add_subparsers(dest="command", required=True)

    rows = subs.add_parser("rows", help="one line per row")
    _add_selection(rows)
    rows.set_defaults(run=cmd_rows)

    curve = subs.add_parser("curve", help="one row's stored curve")
    curve.add_argument("index", type=int)
    _add_curve_opts(curve)
    curve.add_argument("--dump", action="store_true", help="print hz,db pairs instead of a plot")
    curve.add_argument("--cols", type=int, default=PLOT_COLS)
    curve.add_argument("--lines", type=int, default=PLOT_LINES)
    curve.set_defaults(run=cmd_curve)

    band = subs.add_parser("band", help="band statistics per row")
    band.add_argument("index", type=int, nargs="?", help="a single row; omit to sweep every selected row")
    _add_curve_opts(band)
    _add_selection(band)
    band.add_argument("--stat", default=",".join(DEFAULT_STATS), help="comma-separated statistic names")
    band.add_argument("--above", type=float, default=DEFAULT_ABOVE_DB, help="edge_hz allowance over the floor")
    band.add_argument("--baseline-bins", type=int, default=DEFAULT_BASELINE_BINS, help="excess_db baseline width")
    band.add_argument("--summary", action="store_true", help="group by recorded verdict and print 10/50/90 spreads")
    band.set_defaults(run=cmd_band)
    return parser


def main(argv: list[str] | None = None) -> int:
    """Load the captures and run the requested subcommand."""
    opts = build_parser().parse_args(argv)
    files = capture_files(opts.dir)
    if not files:
        print(f"no capture files under {opts.dir}", file=sys.stderr)
        return 1
    return int(opts.run(load_rows(files), opts))


if __name__ == "__main__":
    raise SystemExit(main())
