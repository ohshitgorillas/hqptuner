"""The windowed per-bin minimum spectrum, taken apart once and read the same way by every junk-filter rule.

``Curve`` drops the top bins every rule ignores, holds a 9-bin median-smoothed working curve and a 51-bin wide
baseline, and reads its own noise floor off a low percentile of the smoothed curve. What lives here is generic
across the rules that read a ``Curve``: the curve itself, the excess of every bin over its own wide baseline
(``excesses``), a median filter (``median_smooth``) and a rank correlation against a rising index
(``rank_correlation``) Curve's own smoothing and the ramp rule both use, the fixed-corner lookup table
(``CORNER_KHZ``), and the per-frequency corner split a persistent tone earns (``spur_corner``).
"""

from __future__ import annotations

import math
import statistics

from hqptuner.engine import blockstats

FLOOR_PERCENTILE = 10  # the aggregate's noise floor: a low percentile, not min

# Spurs: raw per-bin values against the curve's own wide median baseline. A
# persistent tone is a few bins wide, which the 9-bin working curve erases.
SPUR_MIN_HZ = 25_000.0
SPUR_BASELINE_BINS = 51
SPUR_CORNER_SPLIT_HZ = 45_000.0  # spur above this → 40k corner still clears it

#: Level over the row's own floor a bin must reach to carry a ceiling or a spur.
CONTRAST_DB = 11.0

#: Excess over the 51-bin baseline above 25 kHz that engages a bin.
SPUR_SPLIT_DB = 22.0

# Fixed-corner filters by corner frequency. A corner at or below the recommended
# one also removes the junk, so it counts as treatment.
CORNER_KHZ = {"20k": 20, "30k": 30, "40k": 40, "50k": 50}


def hz(i: int, bins: int, bandwidth: float) -> float:
    """Centre frequency of bin ``i`` on a grid of ``bins`` bins spanning 0 Hz to ``bandwidth``."""
    return i * bandwidth / (bins - 1)


class Curve:
    """One spectrum as every rule reads it: the top bins gone, smoothed, and its own floor.

    Frequencies stay on the grid the untruncated spectrum came on, so the drop moves no bin's frequency.
    """

    def __init__(self, min_levels_db: list[float], bandwidth: float) -> None:
        """Take the curve apart once: what the three rules share is computed here and nowhere else."""
        self.bins = len(min_levels_db)
        self.bandwidth = bandwidth
        self.levels = min_levels_db[: self.bins - blockstats.DROP_TOP_BINS]
        self.smoothed = median_smooth(self.levels, blockstats.SMOOTH_BINS)
        self.baseline = median_smooth(self.levels, SPUR_BASELINE_BINS)
        self.floor = _percentile(self.smoothed, FLOOR_PERCENTILE)

    def hz(self, i: int) -> float:
        """Return the centre frequency of a kept bin."""
        return hz(i, self.bins, self.bandwidth)

    def at(self, frequency: float) -> int:
        """Return the kept bin nearest a frequency."""
        return min(len(self.levels) - 1, max(0, round(frequency * (self.bins - 1) / self.bandwidth)))

    def above(self, frequency: float) -> int:
        """Return the lowest kept bin at or above a frequency, or one past the last kept bin."""
        return min(len(self.levels), math.ceil(frequency * (self.bins - 1) / self.bandwidth))


def median_smooth(levels: list[float], width: int) -> list[float]:
    """Return each level replaced by the median of the ``width``-wide window centred on it."""
    half = width // 2
    n = len(levels)
    return [statistics.median(levels[max(0, i - half) : min(n, i + half + 1)]) for i in range(n)]


def _percentile(levels: list[float], pct: int) -> float:
    ordered = sorted(levels)
    return ordered[min(len(ordered) - 1, (len(ordered) * pct) // 100)]


def excesses(curve: Curve) -> dict[float, float]:
    """Excess over the wide baseline, by frequency, for every visible bin above 25 kHz."""
    limit = curve.floor + CONTRAST_DB
    return {
        curve.hz(i): curve.levels[i] - curve.baseline[i]
        for i in range(curve.at(SPUR_MIN_HZ), len(curve.levels))
        if curve.levels[i] > limit
    }


def _ranks(values: list[float]) -> list[float]:
    """Return the rank of every value, ties sharing their midpoint rank."""
    order, ranks, start = sorted(range(len(values)), key=lambda i: values[i]), [0.0] * len(values), 0
    while start < len(order):
        stop = start
        while stop + 1 < len(order) and values[order[stop + 1]] == values[order[start]]:
            stop += 1
        for i in order[start : stop + 1]:
            ranks[i] = (start + stop) / 2.0
        start = stop + 1
    return ranks


def rank_correlation(values: list[float]) -> float:
    """Spearman correlation of a series against its own rising index, 0.0 where either side is flat."""
    n = len(values)
    xs, ys = [float(i) for i in range(n)], _ranks(values)
    mx, my = sum(xs) / n, sum(ys) / n
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0.0 or dy == 0.0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / (dx * dy)


def spur_corner(frequency: float) -> str:
    """Return the corner a persistent tone at this frequency earns.

    ``30k`` at or below ``SPUR_CORNER_SPLIT_HZ``, ``40k`` above it. The split is bandwidth-independent.
    """
    return "40k" if frequency > SPUR_CORNER_SPLIT_HZ else "30k"
