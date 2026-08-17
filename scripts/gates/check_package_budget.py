#!/usr/bin/env python3
"""Gate: a package does not grow past its budget, so an extraction cannot pay for itself in new lines.

The per-file gate next door stops one file from swallowing a subsystem, and on
its own it is gameable in a specific way: split the file, leave a one-line
forwarder behind for every method you moved, and the file shrinks while the code
gets bigger and nothing changed for any caller. That is the failure this gate is
pointed at, and it needs no notion of what a forwarder looks like — it just
counts.

An honest extraction is close to line-neutral: the lines leave one file and
arrive in another. A dishonest one is pure addition, because every forwarder is
a line that did not exist before. So a package total that grows across a split
is the split not having happened.

The budget is not a ratchet. Features legitimately make a package bigger, and a
number that only ever fell would freeze the tree. Raising an entry is allowed
and is one reviewable line in the diff; the rule that an extraction may not
raise one lives in CONTRIBUTING.md, where a human reads it. What this gate
guarantees is that the raise cannot happen silently.

BUDGET is opt-in, not exhaustive: a directory with no entry is simply not
measured. Adding an entry is how a package joins.

Usage: ``python scripts/gates/check_package_budget.py``
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Package directory to the total lines permitted across the .py files directly
#: in it. Raise an entry for a feature; never raise one for a refactor.
BUDGET: dict[str, int] = {
    "hqptuner/api": 1473,
    "hqptuner/conf": 2252,
    "hqptuner/engine": 1133,
    "hqptuner/lanes": 949,
    "hqptuner/lanes/live": 1180,
    "hqptuner/presets": 514,
    "hqptuner/presets/store": 1057,
}


def total_lines(package: Path) -> int:
    """Return the summed line count of the .py files directly in a directory.

    Not recursive: a nested package is its own unit and carries its own entry,
    so counting it twice would make the parent's number un-actionable.
    """
    return sum(len(path.read_text().splitlines()) for path in sorted(package.glob("*.py")))


def over(root: Path, budget: dict[str, int]) -> list[str]:
    """Return a line for each budgeted package that measures over its entry, sorted by path."""
    problems = []
    for name in sorted(budget):
        package = root / name
        if not package.is_dir():
            continue
        measured = total_lines(package)
        if measured > budget[name]:
            problems.append(f"{name}: {measured} lines, {budget[name]} budgeted — an extraction does not raise this")
    return problems


def stale(root: Path, budget: dict[str, int]) -> list[str]:
    """Return a line for each budget entry naming no directory, sorted by path."""
    return [f"BUDGET[{name!r}]: names no directory" for name in sorted(budget) if not (root / name).is_dir()]


def check(root: Path, budget: dict[str, int] | None = None) -> int:
    """Refuse a tree where any budgeted package is over its number.

    Both checks run every time, so one fix per run is never the shape of this.
    """
    if budget is None:
        budget = BUDGET
    problems = over(root, budget) + stale(root, budget)

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s). Moving code between files does not change these totals.")
        return 1
    print(f"[ok] all {len(budget)} budgeted packages within budget")
    return 0


def main() -> int:
    """Check this repo, or a tree named on argv."""
    args = sys.argv[1:]
    return check(Path(args[0]) if args else ROOT)


if __name__ == "__main__":
    sys.exit(main())
