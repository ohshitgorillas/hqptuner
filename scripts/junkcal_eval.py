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

Two things a ``label_only`` album's rows do not get. Such an album's depth is the capture's
stored silence rather than a measured fall, so its rows get no cliff scoring on either side:
the cliff leaves the expectation, and the cliff verdict leaves the prediction before the lowest
corner is taken. A row of such an album that supports nothing else leaves the scored set rather
than scoring ``none``, because there is nothing left to grade it on.

Where a cliff-positive row's album carries ``junk_filter: none`` and the row's own ``depth``
clears ``CLIFF_SPLIT_DB``, the expectation is ``20k`` rather than the album's label: a row is
expected the lowest corner its own statistics support, and an album label is the majority
verdict of rows that need not include this one.

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
    from collections.abc import Iterator

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
    """The module surface the adapter needs: one verdict per rule the spectrum fires.

    Per-rule rather than the single name ``classify`` returns, because a ``label_only`` row is
    graded on what it supports minus its cliff, and a corner name alone cannot be taken apart.
    """

    def verdicts(
        self, min_levels_db: list[float] | None, bandwidth: float, *, samplerate: int | None, sdm: bool
    ) -> list[dict[str, Any]]:
        """Return one verdict per rule this spectrum fires."""


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


def row_filter(advisor: Advisor, row: Row, *, label_only: bool) -> str:
    """Return the filter the detector recommends for one row, or ``none``.

    The lowest corner among the rules that fired, the cliff verdict dropped first for a
    ``label_only`` row: the detector reads the full grid at runtime and returns what every rule saw,
    and the scorer alone decides what such a row may be graded on. The 20k corner is the cliff
    rule's alone, so dropping it by name drops that rule and no other.
    """
    found = advisor.verdicts(
        full_curve(row),
        float(row["bandwidth"]),
        samplerate=int(row["samplerate"]),
        sdm=False,
    )
    corners = [str(v["filter"]) for v in found if not (label_only and str(v["filter"]) == "20k")]
    return max(corners, key=FILTERS.index) if corners else "none"


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


def cliff_expectation(label: dict[str, Any], stats: dict[str, Any]) -> str:
    """Return the corner a cliff-positive row is expected, its album's label or its own depth's.

    A row is expected the lowest corner its own statistics support, and an album's ``junk_filter``
    is the majority verdict of rows that need not include this one. Depth only: a row that is
    cliff-positive through the ramp branch carries no depth of its own to outrank the label with.
    """
    name = str(label["junk_filter"])
    if name == "none" and float(stats.get("depth", 0.0)) >= CLIFF_SPLIT_DB:
        return "20k"
    return name


def expected_filter(label: dict[str, Any], stats: dict[str, Any], row: Row) -> str | None:
    """Return the lowest corner one kept row's own statistics support, or None where it is not scored.

    A ``label_only`` album's rows get no cliff scoring, so one supporting nothing else leaves the
    scored set rather than expecting ``none``: its depth is the capture's stored silence and there
    is nothing left to grade it on.
    """
    label_only = bool(label.get("label_only"))
    found: list[str] = []
    if not label_only and cliff_positive(row, stats):
        found.append(cliff_expectation(label, stats))
    if float(stats.get("spur", 0.0)) >= SPUR_SPLIT_DB:
        found.append("40k" if float(stats.get("spur_hz", 0.0)) > SPUR_CORNER_SPLIT_HZ else "30k")
    corners = [name for name in found if name != "none"]
    if corners:
        return max(corners, key=FILTERS.index)
    return None if label_only else "none"


class RowClassifier(Protocol):
    """A scored classifier: one row in, one filter name out, told whether the row's cliff counts."""

    def __call__(self, row: Row, *, label_only: bool) -> str:
        """Return the filter name this classifier gives one row."""


def adapted(advisor: Advisor) -> RowClassifier:
    """Return a row classifier over a detector module's own ``verdicts``."""

    def classify_row(row: Row, *, label_only: bool) -> str:
        return row_filter(advisor, row, label_only=label_only)

    return classify_row


def resolve(dotted: str) -> RowClassifier:
    """Return the classifier a dotted path names, adapting a module to the row shape.

    A callable named directly takes the row alone, as it always has; the pair-format drop is the
    adapter's, so a classifier of one's own is scored on everything it returns.
    """
    try:
        target: Any = importlib.import_module(dotted)
    except ModuleNotFoundError:
        module, _, attr = dotted.rpartition(".")
        target = getattr(importlib.import_module(module), attr)
    if isinstance(target, ModuleType):
        return adapted(target)

    def call_row(row: Row, *, label_only: bool) -> str:
        del label_only  # a classifier named directly is scored on everything it returns
        return str(target(row))

    return call_row


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
        label_only = bool(label.get("label_only"))
        for kept in label["kept"]:
            row = by_ts[str(kept["timestamp"])]
            stats = dict(kept["stats"])
            want = expected_filter(label, stats, row)
            if want is None:
                continue  # a label_only row supporting no finding is not scored
            got = str(classify_row(row, label_only=label_only))
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
