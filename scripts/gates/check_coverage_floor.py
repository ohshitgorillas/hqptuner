#!/usr/bin/env python3
"""Gate: no single source file falls below the coverage floor.

An aggregate floor is a subsidy. A tree at 95% overall can carry a module at
60% indefinitely, because the modules near 100% pay for it — and the module
that needs the tests is precisely the one the aggregate hides. A per-file
minimum is strictly stronger for the failure the aggregate was guarding, so
this replaces ``--cov-fail-under`` rather than standing beside it.

The floor is a standard, not a measurement: it ships at a round number the
tree clears, not at the worst module's percentage minus a point. A floor
derived from the tree ratifies whatever the tree happens to be.

Exemptions are per file with a written reason. A file with no behaviour to
assert is a legitimate exemption; a file nobody got round to testing is not.
An exemption naming a file the report does not carry fails too — a stale
reason is drift wearing a permission slip, the same way it is in
``check_gates_wired.py``.

A missing or empty report fails. This gate runs after the suite in a
pre-commit config with no ``fail_fast``, so a suite that died leaves nothing
behind; passing vacuously there would make the gate worse than absent,
because it would report green over an unmeasured tree.

Usage: ``python scripts/gates/check_coverage_floor.py [report] [floor]``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent

#: Where the `test` target and the `pytest-offline` hook write their report.
REPORT = ROOT / ".coverage.json"

#: The minimum every individual file must reach.
FLOOR = 90

#: Files excused from the floor, path to the reason. A reason is a sentence
#: about the file's nature, not about anyone's plans for it.
EXEMPT: dict[str, str] = {
    "hqptuner/__main__.py": "uvicorn launch shim — no behaviour to assert, and running it starts a server",
}


def percentages(report: Path) -> dict[str, float]:
    """Return path -> percent covered, as coverage.py's JSON report carries it."""
    data: dict[str, Any] = json.loads(report.read_text())
    files: dict[str, Any] = data.get("files") or {}
    return {path: float(entry["summary"]["percent_covered"]) for path, entry in files.items()}


def below(measured: dict[str, float], floor: int, exempt: dict[str, str]) -> list[str]:
    """Return the non-exempt files under the floor, sorted worst first."""
    failing = [path for path, pct in measured.items() if pct < floor and path not in exempt]
    return sorted(failing, key=lambda path: measured[path])


def stale(measured: dict[str, float], exempt: dict[str, str]) -> list[str]:
    """Return exemption keys naming no file in the report, sorted."""
    return sorted(key for key in exempt if key not in measured)


def check(report: Path, floor: int, exempt: dict[str, str] | None = None) -> int:
    """Refuse a tree where any single non-exempt file covers less than ``floor``.

    Both checks run every time: a tree failing the floor still reports its
    stale exemptions, so one fix per run is never the shape of this.
    """
    if exempt is None:
        exempt = EXEMPT
    if not report.is_file():
        print(f"{report}: no coverage report — the suite must run before this gate")
        return 1

    measured = percentages(report)
    if not measured:
        print(f"{report}: coverage report measured no files — nothing was checked")
        return 1

    problems = 0
    for path in below(measured, floor, exempt):
        print(f"{path}: {measured[path]:.2f}% (floor {floor}%)")
        problems += 1
    for key in stale(measured, exempt):
        print(f"EXEMPT[{key!r}]: names no file in the coverage report")
        problems += 1

    if problems:
        print(f"\n{problems} problem(s). Every file covers at least {floor}%, or carries a")
        print("reason in EXEMPT saying what about it has no behaviour to assert.")
        return 1
    print(f"[ok] all {len(measured)} files cover at least {floor}%")
    return 0


def main() -> int:
    """Check this repo's report, or one named on argv."""
    args = sys.argv[1:]
    report = Path(args[0]) if args else REPORT
    floor = int(args[1]) if len(args) > 1 else FLOOR
    return check(report, floor)


if __name__ == "__main__":
    sys.exit(main())
