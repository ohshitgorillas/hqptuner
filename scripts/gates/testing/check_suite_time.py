#!/usr/bin/env python3
"""Gate: the offline suite runs no slower than its bar, within a few seconds.

Reads the junit report ``make test`` writes and compares its wall time with
the bar, kept in a gitignored baseline file. A run within ``ESCALATE``
seconds over the bar passes and leaves it where it is; a passing run faster
than the bar lowers it to that run's time, so the bar never creeps up. A run
past that needs the owner: ``--accept`` records it as the bar. A run ``REJECT`` seconds
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
branch with no baseline yet is judged against the bar of the recorded branch
nearest it in history, the one with the fewest commits on ``HEAD`` not on it,
ties going to the fewest commits on it not on ``HEAD``; a pass records the
faster of the run's time and that bar as the branch's own. With no recorded
branch to start from, the first green run seeds the bar. Each run first
deletes the bars of branches git no longer lists. CI has no baseline and seeds
on every run.

Usage: ``python scripts/gates/testing/check_suite_time.py [--accept]``
"""

from __future__ import annotations

import json
import re
import runpy
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

ROOT = Path(__file__).resolve().parent.parent.parent.parent

#: Seconds over the baseline past which the run needs the owner's accept.
ESCALATE = 5.0
#: Seconds over the baseline at or past which no accept is taken.
REJECT = 10.0

#: Where the `test` target and the `pytest-offline` hook write their report.
REPORT_NAME = ".pytest-junit.xml"
#: The stamp ``scripts/pytest_plugins/run_stamp.py`` writes, holding the run's CPU-wait.
STAMP_NAME = ".pytest-run.json"
#: The bar, beside the main checkout's coverage report,
#: for a tree whose branch cannot be read.
BASELINE_NAME = ".suite-time.json"
#: The same, for one branch: ``{branch}`` with each ``/`` written as ``--``.
BRANCH_BASELINE_NAME = ".suite-time.{branch}.json"

_SUITE = re.compile(r"<testsuite\b[^>]*>")
_ATTR = re.compile(r'\b(\w+)="([^"]*)"')
#: ``git rev-list --left-right --count`` output: the two counts, tab-separated.
_COUNTS = re.compile(r"(\d+)\s+(\d+)")


_CHECKOUT = runpy.run_path(str(ROOT / "scripts" / "git_checkout.py"))
main_checkout: Callable[[Path], Path] = _CHECKOUT["main_checkout"]
own_gitdir: Callable[[Path], Path] = _CHECKOUT["own_gitdir"]
branch: Callable[[Path], str | None] = _CHECKOUT["branch"]


def baseline_path(root: Path) -> Path:
    """Return the baseline file for the branch checked out in ``root``, beside its main checkout."""
    name = branch(root)
    if name is None:
        return main_checkout(root) / BASELINE_NAME
    return main_checkout(root) / BRANCH_BASELINE_NAME.format(branch=name.replace("/", "--"))


def nearest(divergences: dict[str, tuple[int, int]]) -> str | None:
    """Return the branch nearest ``HEAD`` in history, or None with no candidates.

    ``divergences`` maps each candidate branch to the pair (commits on ``HEAD``
    not on the branch, commits on the branch not on ``HEAD``), as
    ``git rev-list --left-right --count HEAD...<branch>`` counts them. Branches
    tied on both counts go to the first by name.
    """
    if not divergences:
        return None
    return min(divergences, key=lambda name: (divergences[name], name))


def recorded_bars(main: Path) -> dict[str, Path]:
    """Return branch -> bar file for every branch with a bar beside the main checkout."""
    prefix, suffix = BRANCH_BASELINE_NAME.split("{branch}")
    return {
        path.name.removeprefix(prefix).removesuffix(suffix).replace("--", "/"): path
        for path in main.glob(f"{prefix}*{suffix}")
    }


def prune(bars: dict[str, Path], live: set[str]) -> list[str]:
    """Delete the bar of every branch not in ``live``; return the branches whose bar went, sorted."""
    gone = sorted(name for name in bars if name not in live)
    for name in gone:
        bars[name].unlink(missing_ok=True)
    return gone


def git(root: Path, *args: str, env: Mapping[str, str] | None = None) -> str | None:
    """Return what ``git args`` prints run in ``root`` under ``env``, or None when git is missing or fails.

    ``env`` is the whole environment git sees; None leaves it the process's own.
    """
    if shutil.which("git") is None:
        return None
    cmd = ["git", *args]
    done = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, check=False)  # noqa: S603
    return done.stdout if done.returncode == 0 else None


def live_branches(root: Path, env: Mapping[str, str] | None = None) -> set[str] | None:
    """Return the branches of ``root``'s repository as ``recorded_bars`` names them, or None when git cannot list them.

    A bar's file name writes ``/`` as ``--``, so a live branch whose name holds
    ``--`` is listed with ``/`` there, the name its bar is recorded under.
    """
    out = git(root, "for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads", env=env)
    return None if out is None else {name.replace("--", "/") for name in out.split()}


def divergence(root: Path, name: str, env: Mapping[str, str] | None = None) -> tuple[int, int] | None:
    """Return (commits on ``HEAD`` not on branch ``name``, commits on it not on ``HEAD``), or None if git cannot say."""
    out = git(root, "rev-list", "--left-right", "--count", f"HEAD...refs/heads/{name}", env=env)
    match = None if out is None else _COUNTS.fullmatch(out.strip())
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def inherited_bar(root: Path, env: Mapping[str, str] | None = None) -> Path | None:
    """Return the bar of the recorded branch nearest ``root``'s ``HEAD``, or None.

    None when ``root``'s branch has a bar of its own, or no other recorded
    branch is one git can count commits against.
    """
    if baseline_path(root).is_file():
        return None
    own = branch(root)
    bars = {name: path for name, path in recorded_bars(main_checkout(root)).items() if name != own}
    divergences = {name: counts for name in bars if (counts := divergence(root, name, env)) is not None}
    near = nearest(divergences)
    return None if near is None else bars[near]


def bar_in_force(root: Path) -> Path:
    """Return the bar file a run in ``root`` is judged against: the inherited bar when there is one, else its own."""
    return inherited_bar(root) or baseline_path(root)


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


def bar_to_meet(baseline: Path, parent: Path | None) -> tuple[float | None, bool]:
    """Return the bar a run is judged against and whether it is ``parent``'s, read only when ``baseline`` holds none."""
    last = read_baseline(baseline)
    if last is not None or parent is None:
        return last, False
    inherited = read_baseline(parent)
    return inherited, inherited is not None


def new_bar(seconds: float, last: float, *, inherited: bool) -> float | None:
    """Return the bar a passing run of ``seconds`` against ``last`` leaves recorded, or None to leave it as it is.

    A run faster than the bar, or one the owner accepted past the escalate
    band, becomes the bar. Any other pass against an inherited bar records
    that bar as the branch's own.
    """
    if seconds < last or seconds - last > ESCALATE:
        return seconds
    return last if inherited else None


def judge(seconds: float, last: float, *, accept: bool) -> tuple[bool, str]:
    """Return whether the run passes against ``last`` and the line saying why."""
    over = seconds - last
    if over >= REJECT:
        return False, f"suite {seconds:.1f}s, bar {last:.1f}s: {over:+.1f}s, rejected (limit {REJECT:.0f}s)"
    if over > ESCALATE:
        if accept:
            return True, f"suite {seconds:.1f}s, bar {last:.1f}s: {over:+.1f}s accepted by the owner"
        return False, f"suite {seconds:.1f}s, bar {last:.1f}s: {over:+.1f}s, escalate to owner (--accept)"
    return True, f"[ok] suite {seconds:.1f}s, bar {last:.1f}s ({over:+.1f}s)"


def check(report: Path, baseline: Path, *, accept: bool = False, wait: float = 0.0, parent: Path | None = None) -> int:
    """Refuse a run slower than the bar by more than ESCALATE seconds.

    The run's time is the report's wall time less ``wait``, the seconds the
    suite's main thread sat waiting for a CPU, so a busy host does not move the
    bar; that time is what is judged and what is recorded. A passing run faster
    than the bar records its time as the bar; one slower leaves the bar where
    it is. A red report (failures or errors non-zero) is
    not judged and not recorded. ``accept`` records a run in the escalate band;
    a run at or past REJECT over the bar is refused either way.

    With no bar in ``baseline``, the run is judged against ``parent``'s, and a
    pass records into ``baseline`` the faster of the run's time and that bar;
    a refused run records nothing. With neither, the run seeds ``baseline``.
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
    seconds = float(attrs["time"]) - wait
    if wait:
        print(f"suite wall time {float(attrs['time']):.1f}s less {wait:.1f}s waiting for a CPU")
    last, inherited = bar_to_meet(baseline, parent)
    if last is None:
        record(baseline, seconds)
        print(f"[ok] suite {seconds:.1f}s, no baseline yet: recorded as the bar")
        return 0
    if inherited:
        print(f"no bar for this branch yet: judged against {parent}")
    passed, line = judge(seconds, last, accept=accept)
    print(line)
    if not passed:
        return 1
    kept = new_bar(seconds, last, inherited=inherited)
    if kept is not None:
        record(baseline, kept)
    return 0


def stamped_wait(stamp: Path) -> float:
    """Return the CPU-wait the run stamp recorded at session finish, zero when it recorded none."""
    if not stamp.is_file():
        return 0.0
    return float(json.loads(stamp.read_text(encoding="utf-8")).get("cpu_wait", 0.0))


def main(argv: list[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    """CLI: optional ``--accept``; report and stamp are this tree's, the bar its branch's beside the main checkout.

    ``env`` is the environment every ``git`` call runs under; None leaves it the process's own.

    The bars of branches git no longer lists are deleted first; when git cannot
    list branches, none is deleted. A branch with no bar of its own is judged
    against the bar of the recorded branch nearest it.
    """
    args = sys.argv[1:] if argv is None else argv
    live = live_branches(ROOT, env)
    if live is not None:
        for name in prune(recorded_bars(main_checkout(ROOT)), live):
            print(f"bar of deleted branch {name} removed")
    wait = stamped_wait(ROOT / STAMP_NAME)
    return check(
        ROOT / REPORT_NAME, baseline_path(ROOT), accept="--accept" in args, wait=wait, parent=inherited_bar(ROOT, env)
    )


if __name__ == "__main__":
    sys.exit(main())
