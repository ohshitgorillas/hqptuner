#!/usr/bin/env python3
"""Score a junk-filter classifier against the labelled junkcal fixture corpus.

Every album under ``tests/support/fixtures/junkcal/`` is read with its ``labels.json`` entry,
handed to a classifier as its list of rows, and the returned filter name is compared with the
album's ``junk_filter`` label. Output is a confusion matrix of labelled against predicted plus
one line per album that missed.

``--classifier`` takes a dotted path. A callable is used as it stands and must accept one
album's rows and return a filter name. A module is adapted: its ``classify`` is called once per
row and the album takes the filter most of its rows carry, ties going to the precedence the
corpus labeller used (ramp, cliff, spur, clean). ``hqptuner.engine.junkadvisor`` is the default,
so a bare run scores HEAD.

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

#: Filter names in the order a tie is broken, the corpus labeller's own precedence: a ramp
#: outranks a cliff, a cliff outranks a spur, and anything outranks nothing detected.
PRECEDENCE = ("50k", "20k", "40k", "30k", "none")


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


def vote(filters: list[str]) -> str:
    """Return the filter most of an album's rows carry, a tie going to PRECEDENCE."""
    counts = {name: filters.count(name) for name in PRECEDENCE}
    best = max(counts.values())
    return next(name for name in PRECEDENCE if counts[name] == best)


def adapted(advisor: Advisor) -> Callable[[Album], str]:
    """Return an album classifier over a detector module's per-row ``classify``."""

    def classify_album(rows: Album) -> str:
        return vote([row_filter(advisor, row) for row in rows])

    return classify_album


def resolve(dotted: str) -> Callable[[Album], str]:
    """Return the classifier a dotted path names, adapting a module to the album shape."""
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
    """Print the confusion matrix of labelled filter against predicted filter."""
    names = [name for name in PRECEDENCE if any(name in pair for pair in pairs)]
    width = max(len(name) for name in names)
    print(f"{'labelled':>{width}} | " + " ".join(f"{name:>{width}}" for name in names) + " | total")
    for want in names:
        row = [sum(1 for w, g in pairs if w == want and g == got) for got in names]
        print(f"{want:>{width}} | " + " ".join(f"{n:>{width}}" for n in row) + f" | {sum(row)}")
    hits = sum(1 for want, got in pairs if want == got)
    print(f"accuracy {hits}/{len(pairs)}")


def main() -> None:
    """Score one classifier over the whole corpus and print the matrix and the misses."""
    ap = argparse.ArgumentParser(description="score a junk-filter classifier against the junkcal corpus")
    ap.add_argument("--classifier", default=DEFAULT_CLASSIFIER, help="dotted path to a module or a callable")
    ap.add_argument("--fixtures", type=Path, default=FIXTURES, help="fixture directory to score against")
    args = ap.parse_args()

    classify_album = resolve(args.classifier)
    pairs: list[tuple[str, str]] = []
    misses: list[str] = []
    for stamp, label, rows in albums(args.fixtures):
        want = str(label["junk_filter"])
        got = str(classify_album(rows))
        pairs.append((want, got))
        if want != got:
            misses.append(
                f"{stamp} labelled={want} predicted={got} class={label['class']} "
                f"sr={label['samplerate']} rows={label['rows']} kept={len(rows)}"
            )
    print_matrix(pairs)
    print(f"misses {len(misses)}")
    for line in misses:
        print(line)


if __name__ == "__main__":
    main()
