#!/usr/bin/env python3
"""Gate: the offline suite runs no slower than the last green run, within a few seconds.

Reads the junit report ``make test`` writes and compares its wall time with
the last green run's, kept in a gitignored baseline file. A run within
``ESCALATE`` seconds of the baseline passes and becomes the baseline. A run
past that needs the owner: ``--accept`` records it. A run ``REJECT`` seconds
or more over the baseline is refused with or without ``--accept``; the way
past is a faster suite.

A red report is not judged and not recorded: a failing test often waits out
a deadline instead of returning on an event, and an aborted run looks fast,
so its time says nothing either way. A missing report fails, as the coverage
floor's does. A missing baseline is seeded from the report, so a fresh
checkout is not red on its first run.

Each branch keeps its own baseline, beside the main checkout's
``.coverage.json`` whichever tree runs the gate: a worktree resolves the
main checkout through git's common dir and the branch from its own ``HEAD``,
so a green run on one branch never judges or moves another branch's bar. A
branch with no baseline yet is seeded. CI has no baseline and seeds on every
run.

Usage: ``python scripts/gates/testing/check_suite_time.py [--accept]``
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent

#: Seconds over the baseline past which the run needs the owner's accept.
ESCALATE = 5.0
#: Seconds over the baseline at or past which no accept is taken.
REJECT = 10.0

#: Where the `test` target and the `pytest-offline` hook write their report.
REPORT_NAME = ".pytest-junit.xml"
#: The last green run's wall time, beside the main checkout's coverage report,
#: for a tree whose branch cannot be read.
BASELINE_NAME = ".suite-time.json"
#: The same, for one branch: ``{branch}`` with each ``/`` written as ``--``.
BRANCH_BASELINE_NAME = ".suite-time.{branch}.json"

_SUITE = re.compile(r"<testsuite\b[^>]*>")
_ATTR = re.compile(r'\b(\w+)="([^"]*)"')


def main_checkout(root: Path) -> Path:
    """Return the main checkout for ``root``, which is ``root`` itself unless it is a worktree.

    A worktree's ``.git`` is a file naming its private git dir, and that dir's
    ``commondir`` file names the shared one, whose parent is the main checkout.
    """
    dotgit = root / ".git"
    if not dotgit.is_file():
        return root
    gitdir = own_gitdir(root)
    common = gitdir / (gitdir / "commondir").read_text().strip()
    return common.resolve().parent


def own_gitdir(root: Path) -> Path:
    """Return the git dir holding ``root``'s own ``HEAD``: ``.git`` itself, or the one a worktree's ``.git`` names."""
    dotgit = root / ".git"
    if not dotgit.is_file():
        return dotgit
    gitdir = Path(dotgit.read_text().split(":", 1)[1].strip())
    return gitdir if gitdir.is_absolute() else root / gitdir


def branch(root: Path) -> str | None:
    """Return the branch checked out in ``root``, the commit a detached ``HEAD`` names, or None outside git."""
    head = own_gitdir(root) / "HEAD"
    if not head.is_file():
        return None
    text = head.read_text().strip()
    return text.removeprefix("ref: refs/heads/")


def baseline_path(root: Path) -> Path:
    """Return the baseline file for the branch checked out in ``root``, beside its main checkout."""
    name = branch(root)
    if name is None:
        return main_checkout(root) / BASELINE_NAME
    return main_checkout(root) / BRANCH_BASELINE_NAME.format(branch=name.replace("/", "--"))


def suite_attrs(report: Path) -> dict[str, str]:
    """Return the ``<testsuite>`` element's attributes from a junit report."""
    match = _SUITE.search(report.read_text())
    if match is None:
        return {}
    return dict(_ATTR.findall(match.group(0)))


def read_baseline(baseline: Path) -> float | None:
    """Return the recorded wall time, or None when nothing has been recorded."""
    if not baseline.is_file():
        return None
    return float(json.loads(baseline.read_text())["seconds"])


def record(baseline: Path, seconds: float) -> None:
    """Make ``seconds`` the baseline."""
    baseline.write_text(json.dumps({"seconds": seconds}) + "\n")


def judge(seconds: float, last: float, *, accept: bool) -> tuple[bool, str]:
    """Return whether the run passes against ``last`` and the line saying why."""
    over = seconds - last
    if over >= REJECT:
        return False, f"suite {seconds:.1f}s, last green {last:.1f}s: {over:+.1f}s, rejected (limit {REJECT:.0f}s)"
    if over > ESCALATE:
        if accept:
            return True, f"suite {seconds:.1f}s, last green {last:.1f}s: {over:+.1f}s accepted by the owner"
        return False, f"suite {seconds:.1f}s, last green {last:.1f}s: {over:+.1f}s, escalate to owner (--accept)"
    return True, f"[ok] suite {seconds:.1f}s, last green {last:.1f}s ({over:+.1f}s)"


def check(report: Path, baseline: Path, *, accept: bool = False) -> int:
    """Refuse a run slower than the last green run by more than ESCALATE seconds.

    Exit 0 records the report's time as the new baseline. A red report
    (failures or errors non-zero) is not judged and not recorded. ``accept``
    records a run in the escalate band; a run at or past REJECT over the
    baseline is refused either way.
    """
    if not report.is_file():
        print(f"{report}: no junit report; the suite must run before this gate")
        return 1
    attrs = suite_attrs(report)
    if "time" not in attrs:
        print(f"{report}: no <testsuite time=...> in the report; nothing was measured")
        return 1
    if attrs.get("failures", "0") != "0" or attrs.get("errors", "0") != "0":
        print(f"{report}: suite red, time not judged")
        return 1
    seconds = float(attrs["time"])
    last = read_baseline(baseline)
    if last is None:
        record(baseline, seconds)
        print(f"[ok] suite {seconds:.1f}s, no baseline yet: recorded as the bar")
        return 0
    passed, line = judge(seconds, last, accept=accept)
    print(line)
    if passed:
        record(baseline, seconds)
        return 0
    return 1


def main(argv: list[str] | None = None) -> int:
    """CLI: optional ``--accept``; the report is this tree's, the baseline its branch's beside the main checkout."""
    args = sys.argv[1:] if argv is None else argv
    return check(ROOT / REPORT_NAME, baseline_path(ROOT), accept="--accept" in args)


if __name__ == "__main__":
    sys.exit(main())
