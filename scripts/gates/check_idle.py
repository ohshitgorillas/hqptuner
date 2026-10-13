#!/usr/bin/env python3
"""Gate: no test's idle rises more than LIMIT over its previous reading on the branch.

Reads the report ``scripts/idle_probe.py`` writes and judges each test's idle
against the reading the last green run on the same branch left for it. A test
fails when its reading rises more than ``LIMIT`` over that previous reading,
or, with no previous reading, when the reading itself exceeds ``LIMIT``. The
run's readings then replace the record whether or not they passed, so a busy
host can fail a good test once and the next run is judged against that reading.

A node id the run did not report drops out of the record, because the plugin
loads on two whole-suite command lines only, so an absent id is a renamed or
deleted test.

A red session is not recorded and not judged: a failing test often waits out a
deadline instead of returning on an event, and the seconds that produces belong
to the failure rather than to the test. A missing report fails, as the suite
time gate's does.

Each branch keeps its own record, beside the main checkout's other gate state
whichever tree runs the gate: a worktree resolves the main checkout through
git's common dir and the branch from its own ``HEAD``, so a run on one branch
never judges or moves another branch's record.

Usage: ``python scripts/gates/check_idle.py``
"""

from __future__ import annotations

import json
import runpy
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

ROOT = Path(__file__).resolve().parent.parent.parent

#: Seconds a test's idle may rise over its previous reading, or reach with none.
LIMIT = 0.040

#: Where the plugin writes its report.
REPORT_NAME = ".idle-probe.json"
#: Each test's latest idle, beside the main checkout, for a tree whose branch cannot be read.
RECORD_NAME = ".idle-last.json"
#: The same, for one branch: ``{branch}`` with each ``/`` written as ``--``.
BRANCH_RECORD_NAME = ".idle-last.{branch}.json"


_CHECKOUT = runpy.run_path(str(ROOT / "scripts" / "git_checkout.py"))
main_checkout: Callable[[Path], Path] = _CHECKOUT["main_checkout"]
branch: Callable[[Path], str | None] = _CHECKOUT["branch"]


def record_path(root: Path) -> Path:
    """Return the record file for the branch checked out in ``root``, beside its main checkout."""
    name = branch(root)
    if name is None:
        return main_checkout(root) / RECORD_NAME
    return main_checkout(root) / BRANCH_RECORD_NAME.format(branch=name.replace("/", "--"))


def read_record(path: Path) -> dict[str, float]:
    """Return the recorded readings, empty when nothing has been recorded yet."""
    if not path.is_file():
        return {}
    return {name: float(seconds) for name, seconds in json.loads(path.read_text()).items()}


def write_record(path: Path, readings: dict[str, float]) -> None:
    """Write this run's readings as the record."""
    path.write_text(json.dumps(readings, sort_keys=True) + "\n", encoding="utf-8")


def refusal(name: str, seconds: float, previous: float | None) -> str | None:
    """Return why ``name``'s reading fails against ``previous``, or None when it passes.

    The rise is rounded to microseconds, the precision the probe records at, so
    a rise of exactly ``LIMIT`` passes rather than failing on float residue.
    """
    if previous is None:
        if seconds > LIMIT:
            return (
                f"{name}: idle {seconds * 1000:.0f} ms, no previous reading on this branch"
                f" (max {LIMIT * 1000:.0f} ms)"
            )
        return None
    rise = round(seconds - previous, 6)
    if rise > LIMIT:
        return (
            f"{name}: idle {seconds * 1000:.0f} ms, up {rise * 1000:.0f} ms from {previous * 1000:.0f} ms"
            f" (max rise {LIMIT * 1000:.0f} ms)"
        )
    return None


def refusals(previous: dict[str, float], measured: dict[str, float]) -> list[str]:
    """Return one line per test whose reading fails against its previous one, in node id order."""
    lines = (refusal(name, measured[name], previous.get(name)) for name in sorted(measured))
    return [line for line in lines if line is not None]


def check(report: Path, record: Path) -> int:
    """Refuse a run in which a test's idle rose more than LIMIT, then record the run's readings."""
    if not report.is_file():
        print(f"{report}: no idle report; the suite must run with -p idle_probe before this gate")
        return 1
    measured = json.loads(report.read_text())
    if int(measured.get("exitstatus", 0)) != 0:
        print(f"{report}: suite red, idle not judged and not recorded")
        return 1

    readings = {name: float(seconds) for name, seconds in measured["tests"].items()}
    failed = refusals(read_record(record), readings)
    write_record(record, readings)

    for line in failed:
        print(line)
    if failed:
        print(
            f"\n{len(failed)} test(s) waiting longer on a real clock. These readings are recorded,"
            " so the next run is judged against them: a rerun clears a rise a busy host caused."
        )
        return 1
    return 0


def main() -> int:
    """CLI: report from this tree, record for its branch beside the main checkout."""
    return check(ROOT / REPORT_NAME, record_path(ROOT))


if __name__ == "__main__":
    sys.exit(main())
