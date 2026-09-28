#!/usr/bin/env python3
"""Gate: no test in the offline suite lets a real-clock timeout run out.

Reads the report ``scripts/clock_probe.py`` writes and refuses any test with an
expired timeout above zero. The reading is the timeout the code asked for, not
the time that passed, so it is the same on every machine and needs no record
and no threshold.

A red session is not judged: a failing test often waits out a deadline instead
of returning on an event. A missing report fails, as the idle gate's does.

Usage: ``python scripts/gates/check_clock_waits.py``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Where the plugin writes its report.
REPORT_NAME = ".clock-probe.json"


def waiting(tests: dict[str, dict[str, float]]) -> list[str]:
    """Return the node ids with any expired real-clock timeout, sorted."""
    return sorted(name for name, kinds in tests.items() if any(seconds > 0 for seconds in kinds.values()))


def check(report: Path) -> int:
    """Refuse a green session in which any test let a real-clock timeout run out."""
    if not report.is_file():
        print(f"{report}: no clock report; the suite must run with -p clock_probe before this gate")
        return 1
    measured = json.loads(report.read_text())
    if int(measured.get("exitstatus", 0)) != 0:
        print(f"{report}: suite red, clock waits not judged")
        return 1
    tests: dict[str, dict[str, float]] = measured["tests"]
    names = waiting(tests)
    for name in names:
        kinds = ", ".join(f"{kind} {seconds * 1000:.0f} ms" for kind, seconds in sorted(tests[name].items()))
        print(f"{name}: real-clock timeout ran out ({kinds})")
    if names:
        print(f"\n{len(names)} test(s) waiting on a real clock (docs/testing.md rule 7).")
        return 1
    return 0


def main() -> int:
    """CLI: judge the report in this tree."""
    return check(ROOT / REPORT_NAME)


if __name__ == "__main__":
    sys.exit(main())
