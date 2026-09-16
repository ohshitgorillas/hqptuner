#!/usr/bin/env python3
"""Score a junk-filter classifier against the labelled junkcal fixture corpus.

Every kept row under ``tests/support/fixtures/junkcal/`` is handed to a classifier on its own
and the returned filter name is compared with the filter that row's own statistics in
``labels.json`` imply. Output is a confusion matrix of expected against predicted plus one line
per row that missed, carrying its album and its roles.

A row is scored against itself rather than against its album, because an album's label is the
majority verdict and a kept row need not carry it: a clean album keeps its near-miss row, and
that row can carry a spur over the corpus split. Scoring such a row against ``none`` counts a
correct verdict as a miss. The per-row expectation is the lowest corner among every finding the
row's own statistics support by the fixture's splits: its album's ``junk_filter`` where the row
is cliff- or ramp-positive, and the filter whose corner sits just below ``spur_hz`` where the
row carries a spur at or over ``SPUR_SPLIT_DB``. A row supporting nothing expects ``none``, a
spur-absent row included.

``--classifier`` takes a dotted path. A callable is used as it stands and must accept one row
and return a filter name. A module is adapted: its ``classify`` is called on the row's own
spectrum. ``hqptuner.engine.junkadvisor`` is the default, so a bare run scores HEAD.

The fixture is read, never written.
"""

from __future__ import annotations

import argparse
import gzip
import importlib
import json
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

Row = dict[str, Any]
Album = list[Row]

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "support" / "fixtures" / "junkcal"
DEFAULT_CLASSIFIER = "hqptuner.engine.junkadvisor"

#: Filter names in corner order, the order the matrix prints.
FILTERS = ("50k", "40k", "30k", "20k", "none")

#: The fixture's own spur split, ``scripts/junkcal_fixture.py`` ``SPUR_SPLIT_DB``: excess over
#: the 51-bin baseline above 25 kHz that a row must carry for a spur to be present.
SPUR_SPLIT_DB = 22.0

#: The fixture's own corner split, ``scripts/junkcal_fixture.py`` ``SPUR_CORNER_SPLIT_HZ``: the
#: spur bin above which the 40k corner sits just below the spur, and below which the 30k one does.
SPUR_CORNER_SPLIT_HZ = 45_000.0

#: The fixture's own cliff split, ``scripts/junkcal_fixture.py`` ``CLIFF_SPLIT_DB``: reference
#: band minus the median above the ceiling that a flat row must carry to be cliff-positive.
CLIFF_SPLIT_DB = 30.0

#: The fixture's own ramp splits, ``scripts/junkcal_fixture.py`` ``RAMP_TOP_SPLIT_DB`` and
#: ``RAMP_MIN_RATE``: top-band level over the floor, and the rate below which no row ramps.
RAMP_TOP_SPLIT_DB = 3.0
RAMP_MIN_RATE = 176_400


class Advisor(Protocol):
    """The module surface the adapter needs: the detector's own entry point."""

    def classify(
        self, min_levels_db: list[float] | None, bandwidth: float, *, samplerate: int | None, sdm: bool
    ) -> dict[str, Any] | None:
        """Return the signature a spectrum carries, or None when there is nothing to say."""


def full_curve(row: Row) -> list[float]:
    """Return one row's spectrum on the full bin grid the detector indexes.

    A capture stores ``[hz, db]`` pairs from 13 kHz up (``hqptuner/core/junkcal.py``
    ``SPECTRUM_FLOOR_HZ``), so the head of the grid is missing and every frequency the detector
    reads would land in the wrong bin. The head is restored at the row's own maximum level:
    no rule reads a band that low, and the only statistic the fill can reach is the
    10th-percentile floor, which must go on reading the HF tail rather than the fill.
    """
    spec = row["spectrum"]
    if spec and isinstance(spec[0], list):
        levels = [float(pair[1]) for pair in spec]
        return [max(levels)] * (int(row["bins"]) - len(levels)) + levels
    return [float(v) for v in spec]


def row_filter(advisor: Advisor, row: Row) -> str:
    """Return the filter the detector recommends for one row, or ``none``."""
    verdict = advisor.classify(
        full_curve(row),
        float(row["bandwidth"]),
        samplerate=int(row["samplerate"]),
        sdm=False,
    )
    return str(verdict["filter"]) if verdict else "none"


def is_pairs(row: Row) -> bool:
    """Report whether a row stores ``[hz, db]`` pairs rather than a flat level list."""
    spec = row["spectrum"]
    return bool(spec) and isinstance(spec[0], list)


def ramp_positive(row: Row, stats: dict[str, Any]) -> bool:
    """Report whether a row's top band rises, ``scripts/junkcal_fixture.py`` ``ramp_pos``."""
    if int(row["samplerate"]) < RAMP_MIN_RATE:
        return False
    return float(stats.get("slope", 0.0)) > 0.0 and float(stats.get("top_rel", 0.0)) >= RAMP_TOP_SPLIT_DB


def cliff_positive(row: Row, stats: dict[str, Any]) -> bool:
    """Report whether a row's content stops, ``scripts/junkcal_fixture.py`` ``cliff_pos``.

    A pairs row carries the capture's stored ceiling rather than a measured depth, so its
    presence is the finding; a flat row needs its depth over the corpus split.
    """
    if ramp_positive(row, stats):
        return True
    if is_pairs(row):
        return float(stats.get("ceiling_hz", 0.0)) > 0.0
    return float(stats.get("depth", 0.0)) >= CLIFF_SPLIT_DB


def expected_filter(label: dict[str, Any], stats: dict[str, Any], row: Row) -> str:
    """Return the lowest corner among the findings one kept row's own statistics support."""
    found: list[str] = []
    if cliff_positive(row, stats):
        found.append(str(label["junk_filter"]))
    if float(stats.get("spur", 0.0)) >= SPUR_SPLIT_DB:
        found.append("40k" if float(stats.get("spur_hz", 0.0)) > SPUR_CORNER_SPLIT_HZ else "30k")
    corners = [name for name in found if name != "none"]
    return max(corners, key=FILTERS.index) if corners else "none"


def adapted(advisor: Advisor) -> Callable[[Row], str]:
    """Return a row classifier over a detector module's own ``classify``."""

    def classify_row(row: Row) -> str:
        return row_filter(advisor, row)

    return classify_row


def resolve(dotted: str) -> Callable[[Row], str]:
    """Return the classifier a dotted path names, adapting a module to the row shape."""
    try:
        target: Any = importlib.import_module(dotted)
    except ModuleNotFoundError:
        module, _, attr = dotted.rpartition(".")
        target = getattr(importlib.import_module(module), attr)
    return adapted(target) if isinstance(target, ModuleType) else target


def albums(fixtures: Path) -> Iterator[tuple[str, dict[str, Any], Album]]:
    """Yield every album in the corpus: its stamp, its labels entry and its rows."""
    with (fixtures / "labels.json").open(encoding="utf-8") as fh:
        labels: dict[str, Any] = json.load(fh)
    for stamp, label in sorted(labels.items()):
        with gzip.open(fixtures / f"{stamp}.jsonl.gz", "rt", encoding="utf-8") as gz:
            yield stamp, label, [json.loads(line) for line in gz if line.strip()]


def print_matrix(pairs: list[tuple[str, str]]) -> None:
    """Print the confusion matrix of expected filter against predicted filter."""
    names = [name for name in FILTERS if any(name in pair for pair in pairs)]
    width = max(len(name) for name in names)
    print(f"{'expected':>{width}} | " + " ".join(f"{name:>{width}}" for name in names) + " | total")
    for want in names:
        row = [sum(1 for w, g in pairs if w == want and g == got) for got in names]
        print(f"{want:>{width}} | " + " ".join(f"{n:>{width}}" for n in row) + f" | {sum(row)}")
    hits = sum(1 for want, got in pairs if want == got)
    print(f"accuracy {hits}/{len(pairs)}")


def main() -> None:
    """Score one classifier over every kept row and print the matrix and the misses."""
    ap = argparse.ArgumentParser(description="score a junk-filter classifier against the junkcal corpus")
    ap.add_argument("--classifier", default=DEFAULT_CLASSIFIER, help="dotted path to a module or a callable")
    ap.add_argument("--fixtures", type=Path, default=FIXTURES, help="fixture directory to score against")
    args = ap.parse_args()

    classify_row = resolve(args.classifier)
    pairs: list[tuple[str, str]] = []
    misses: list[str] = []
    for stamp, label, rows in albums(args.fixtures):
        by_ts = {str(row["timestamp"]): row for row in rows}
        for kept in label["kept"]:
            row = by_ts[str(kept["timestamp"])]
            stats = dict(kept["stats"])
            want = expected_filter(label, stats, row)
            got = str(classify_row(row))
            pairs.append((want, got))
            if want != got:
                misses.append(
                    f"{stamp} roles={','.join(kept['roles'])} expected={want} predicted={got} "
                    f"album={label['junk_filter']} class={label['class']} sr={label['samplerate']} "
                    f"spur={stats.get('spur', 0.0)} spur_hz={stats.get('spur_hz', 0.0)} ts={kept['timestamp']}"
                )
    print_matrix(pairs)
    print(f"misses {len(misses)}")
    for line in misses:
        print(line)


if __name__ == "__main__":
    main()
