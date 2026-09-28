#!/usr/bin/env python3
"""Read junkcal capture files and show the stored spectra directly.

The captures hold the detector's input, one row per tick: the engine context, the aggregate's coverage and grid, and
the windowed minimum spectrum from the lossy window's floor upward. The recorded ``verdict`` is the current rules'
output, not ground truth; this tool reports it as one column among many and otherwise ignores it.

One thing is worth knowing before reading anything here: the row stores the windowed *minimum* spectrum, which is
every rule's input. ``junkadvisor``'s cliff, spur and ramp rules all read a curve derived from it, so any recorded
verdict can be recomputed from the row that carries it.

This module holds the row model, the loader and every statistic.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import argparse
    from pathlib import Path

FLOOR_PERCENTILE = 10
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


class InvalidBandError(ValueError):
    """A band argument was not the required ``LO:HI`` shape."""

    def __init__(self, *, text: str) -> None:
        """Name the malformed band `text`."""
        super().__init__(f"band must be LO:HI, got {text!r}")


def parse_band(text: str) -> tuple[float, float]:
    """Return ``(lo, hz)`` from ``LO:HI``, either side open, defaulting to the whole curve."""
    if ":" not in text:
        raise InvalidBandError(text=text)
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


@dataclass
class BandStats:
    """Every statistic this tool knows, computed over one band of one row's stored curve.

    Every field is always present; a statistic a band cannot support (an empty band's spread, a spur measure with
    no data) reads NaN, the module's own convention for "no value" on a numeric stat, rather than being omitted.
    """

    count: float = 0.0
    mean: float = math.nan
    median: float = math.nan
    min: float = math.nan
    max: float = math.nan
    p10: float = math.nan
    p90: float = math.nan
    argmax_hz: float = math.nan
    slope_db_per_khz: float = math.nan
    excess_db: float = math.nan
    excess_hz: float = math.nan
    edge_hz: float = math.nan
    floor: float = math.nan


def band_stats(row: Row, band: tuple[float, float], opts: argparse.Namespace) -> BandStats | None:
    """Return every statistic this tool knows over ``band`` of ``row``'s stored curve, or None when it has no curve."""
    freqs, levels = row.curve
    if not freqs:
        return None
    working = median_smooth(levels, opts.smooth)
    floor = percentile(median_smooth(levels, 9), FLOOR_PERCENTILE)
    band_freqs, band_levels = slice_band(freqs, working, band)
    if not band_freqs:
        return BandStats(count=0.0, floor=floor)
    excess_db, excess_hz = _excess(band_freqs, band_levels, opts.baseline_bins)
    peak = max(band_levels)
    return BandStats(
        count=float(len(band_levels)),
        mean=sum(band_levels) / len(band_levels),
        median=statistics.median(band_levels),
        min=min(band_levels),
        max=peak,
        p10=percentile(band_levels, 10),
        p90=percentile(band_levels, 90),
        argmax_hz=band_freqs[band_levels.index(peak)],
        slope_db_per_khz=_slope_per_hz(band_freqs, band_levels) * 1000.0,
        excess_db=excess_db,
        excess_hz=excess_hz,
        edge_hz=_edge_hz(band_freqs, band_levels, floor + opts.above),
        floor=floor,
    )


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
