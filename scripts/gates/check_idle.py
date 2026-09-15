#!/usr/bin/env python3
"""Gate: no test in the offline suite waits on a real clock for longer than THRESHOLD.

Reads the report ``scripts/idle_probe.py`` writes and merges it into a
gitignored record of the smallest idle each test has ever been measured at.
Jitter only ever adds idle, so a per-test minimum converges downward on the
wait the test actually holds and never drifts upward past the threshold by
accident. No number in the record can be raised by a run: it is a convergence
record, not a baseline.

A node id the run did not report is dropped, because the plugin loads on two
whole-suite command lines only, so an absent id is a renamed or deleted test.

A red session is not recorded and not judged: a failing test often waits out a
deadline instead of returning on an event, and the seconds that produces belong
to the failure rather than to the test. A missing report fails, as the suite
time gate's does.

The record lives beside the main checkout's other gate state whichever tree runs
the gate, so a worktree is judged against dev's measurements rather than seeding
a fresh set.

Usage: ``python scripts/gates/check_idle.py``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Seconds of idle a single test may hold before the gate refuses it.
THRESHOLD = 0.040

#: Where the plugin writes its report.
REPORT_NAME = ".idle-probe.json"
#: The smallest idle each test has been measured at, beside the main checkout.
MINIMA_NAME = ".idle-min.json"


def main_checkout(root: Path) -> Path:
    """Return the main checkout for ``root``, which is ``root`` itself unless it is a worktree.

    A worktree's ``.git`` is a file naming its private git dir, and that dir's
    ``commondir`` file names the shared one, whose parent is the main checkout.
    """
    dotgit = root / ".git"
    if not dotgit.is_file():
        return root
    gitdir = Path(dotgit.read_text().split(":", 1)[1].strip())
    if not gitdir.is_absolute():
        gitdir = root / gitdir
    common = gitdir / (gitdir / "commondir").read_text().strip()
    return common.resolve().parent


def read_minima(minima: Path) -> dict[str, float]:
    """Return the recorded minima, empty when nothing has been recorded yet."""
    if not minima.is_file():
        return {}
    return {name: float(seconds) for name, seconds in json.loads(minima.read_text()).items()}


def merge(seen: dict[str, float], measured: dict[str, float]) -> dict[str, float]:
    """Return the record this run leaves: the smallest reading per test, this run's tests only."""
    return {name: min(seen.get(name, seconds), seconds) for name, seconds in measured.items()}


def record(minima: Path, seen: dict[str, float]) -> None:
    """Write the merged record."""
    minima.write_text(json.dumps(seen, sort_keys=True) + "\n", encoding="utf-8")


def check(report: Path, minima: Path) -> int:
    """Refuse a tree where a test's smallest measured idle exceeds THRESHOLD."""
    if not report.is_file():
        print(f"{report}: no idle report; the suite must run with -p idle_probe before this gate")
        return 1
    measured = json.loads(report.read_text())
    if int(measured.get("exitstatus", 0)) != 0:
        print(f"{report}: suite red, idle not judged and not recorded")
        return 1

    seen = merge(read_minima(minima), {name: float(seconds) for name, seconds in measured["tests"].items()})
    record(minima, seen)

    over = sorted((seconds, name) for name, seconds in seen.items() if seconds > THRESHOLD)
    for seconds, name in over:
        print(f"{name}: idle {seconds * 1000:.0f} ms (max {THRESHOLD * 1000:.0f} ms)")
    if over:
        print(
            f"\n{len(over)} test(s) waiting on a real clock. A stored minimum only ever falls, so a"
            " run of the same suite clears jitter; a number that stays is a wait the test holds."
        )
        return 1
    return 0


def main() -> int:
    """CLI: report from this tree, record resolved to the main checkout."""
    return check(ROOT / REPORT_NAME, main_checkout(ROOT) / MINIMA_NAME)


if __name__ == "__main__":
    sys.exit(main())
