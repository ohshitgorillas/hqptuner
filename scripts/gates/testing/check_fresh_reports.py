#!/usr/bin/env python3
"""Gate: every report the offline suite writes comes from the latest run.

A run killed by the suite deadline, or one that crashes, writes no reports and
leaves the previous run's on disk; the report gates would read those and pass.
``scripts/pytest_plugins/run_stamp.py`` stamps each run's start, and this gate
refuses a report that is missing or older than that start. A missing stamp
fails too: a tree with no recorded run must not read as a fresh one.

Usage: ``python scripts/gates/testing/check_fresh_reports.py``
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent

#: The stamp ``scripts/pytest_plugins/run_stamp.py`` writes when a run starts.
STAMP_NAME = ".pytest-run.json"

#: The reports a run writes when it finishes, which the report gates read.
REPORT_NAMES = (".pytest-junit.xml", ".coverage.json", ".idle-probe.json", ".clock-probe.json")


def run_start(stamp: Path) -> float | None:
    """Return the start the stamp records, or None when no run has stamped."""
    if not stamp.is_file():
        return None
    return float(json.loads(stamp.read_text(encoding="utf-8"))["start"])


def check(stamp: Path, reports: list[Path]) -> int:
    """Refuse a report missing, or older than the run the stamp records.

    Every report is judged, so a tree with several stale reports names them all.
    """
    start = run_start(stamp)
    if start is None:
        print(f"{stamp}: no run stamp; the suite must run with -p run_stamp before this gate")
        return 1

    now = time.time()
    stamp_age = now - start
    problems = 0
    for report in reports:
        if not report.is_file():
            print(f"{report}: missing; the run stamped {stamp_age:.1f}s ago wrote no report")
            problems += 1
            continue
        mtime = report.stat().st_mtime
        if mtime < start:
            print(f"{report}: {now - mtime:.1f}s old, older than the run stamped {stamp_age:.1f}s ago")
            problems += 1

    if problems:
        print(f"\n{problems} report(s) not written by the latest run; the run did not finish.")
        return 1
    print(f"[ok] all {len(reports)} reports written by the run stamped {stamp_age:.1f}s ago")
    return 0


def main() -> int:
    """CLI: the stamp and the reports in this tree."""
    return check(ROOT / STAMP_NAME, [ROOT / name for name in REPORT_NAMES])


if __name__ == "__main__":
    sys.exit(main())
