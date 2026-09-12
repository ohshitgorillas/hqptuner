#!/usr/bin/env python3
"""Gate: no single source file falls below the coverage floor.

Reads the JSON report ``make test`` writes and refuses any file under the
floor. Exemptions are per file, each with a reason; an exemption naming no
file in the report fails too.

A missing or empty report fails rather than passing. Pre-commit sets no
``fail_fast``, so this still runs when the suite dies, and a tree that was
never measured must not read as a tree that measured clean.

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

#: Files excused from the floor, path to the reason.
EXEMPT: dict[str, str] = {
    "hqptuner/__main__.py": "uvicorn launch shim — no behavior to assert, and running it starts a server",
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

    Both checks run every time, so one fix per run is never the shape of this.
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
        print("reason in EXEMPT saying what about it has no behavior to assert.")
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
