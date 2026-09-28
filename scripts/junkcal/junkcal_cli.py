#!/usr/bin/env python3
"""Command-line surface for ``junkcal_view``'s stats engine.

The ``rows`` / ``curve`` / ``band`` subcommands, their argument parser, and
the printing each one does.

    .venv/bin/python scripts/junkcal/junkcal_cli.py <subcommand> ...
"""

from __future__ import annotations

import argparse
import math
import statistics
import sys
from pathlib import Path

from junkcal_view import (
    BandStats,
    Row,
    band_stats,
    capture_files,
    load_rows,
    median_smooth,
    parse_band,
    percentile,
    select,
    slice_band,
)

DEFAULT_DIR = Path("/srv/hqptuner/state/junkcal")
DEFAULT_ABOVE_DB = 8.0
DEFAULT_BASELINE_BINS = 51
DEFAULT_STATS = ("count", "mean", "median", "max", "argmax_hz", "slope_db_per_khz", "excess_db", "excess_hz")
PLOT_COLS = 100
PLOT_LINES = 24


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
    grouped: dict[str, list[BandStats]] = {}
    for row in chosen:
        stats = band_stats(row, band, opts)
        if stats is not None:
            grouped.setdefault(_verdict_class(row), []).append(stats)
    print(f"{'class':<8} {'rows':>6} {'statistic':<18} {'p10':>10} {'p50':>10} {'p90':>10}")
    for name in sorted(grouped):
        bucket = grouped[name]
        for stat in names:
            p10, p50, p90 = _quantiles([getattr(s, stat, math.nan) for s in bucket])
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
        if stats is None:
            continue
        cells = "".join(f" {_fmt(getattr(stats, n, math.nan))}" for n in names)
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
