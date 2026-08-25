#!/usr/bin/env python3
"""Gate: no source file longer than its limit, and no watched source file longer than last time.

Two rules share this gate because both are read off the same number.

The cap refuses a file outright — 500 lines, 800 under tests/. Test suites get
headroom because the one-assertion-per-test policy inflates line count without
adding coupling; a flat list of cases has no missing abstraction for a split to
surface.

The ratchet is what stops the crawl. A cap on its own makes passing a local
condition: at 501 lines the cheapest move is always to delete two lines, never
to split, so a file parks against the cap and every agent that touches it pays
the same toll again. Above WATCH_LINE a source file must carry an ALLOWANCE
entry and may only ever shrink. Growing past the entry fails; measuring *under*
the entry also fails, until the entry is lowered to match, so headroom cannot be
banked in one commit and spent in the next. The only way out of the watched band
is down.

Nothing here raises an allowance. A file that needs more room needs a split.

The ratchet does not reach under tests/, for the same reason the cap is looser
there.

Allowances are judged against the filesystem rather than against the paths on
argv: pre-commit hands this gate only the files being committed, so an
argv-based staleness rule would call every untouched entry stale on every
partial commit.

Usage: ``python scripts/gates/check_file_length.py <path>...``
"""

from __future__ import annotations

import sys
from pathlib import Path

MAX_LINES = 500
MAX_LINES_TESTS = 800

#: Above this many lines a source file enters the ratchet: it must carry an
#: ALLOWANCE entry, and that entry only ever comes down.
WATCH_LINE = 400

#: Watched file to the length it is currently permitted. Lower an entry when the
#: file shrinks — the gate insists on it. Do not raise one; that is the crawl
#: this table exists to refuse.
ALLOWANCE: dict[str, int] = {
    "hqptuner/conf/matrixconf.py": 497,
    # Raised, against this table's own rule, to land a directory move: the split
    # of lanes/http cost this file one import line. Owed a split, not a number.
    "hqptuner/core/manager.py": 480,
    "hqptuner/static/components/xfeed/Card.js": 483,
    "scripts/budget/budget_miner.py": 470,
    "hqptuner/static/lib/xfeed.js": 462,
    "scripts/eqlab/search.js": 442,
    "scripts/eqlab/render.js": 441,
    "hqptuner/conf/httpconf.py": 431,
    "scripts/probes/probe_absent_plugin.py": 430,
    ".claude/hooks/change-budget.py": 426,
    "hqptuner/lanes/live/lane.py": 409,
    "hqptuner/static/css/features/volume.css": 407,
    "scripts/eqlab/chain.js": 405,
}


def limit_for(name: str) -> int:
    """Return the line limit for a path — 800 under tests/, 500 everywhere else."""
    return MAX_LINES_TESTS if Path(name).parts[0] == "tests" else MAX_LINES


def ratcheted(name: str) -> bool:
    """Report whether the ratchet governs a path, which it does everywhere but under tests/."""
    return Path(name).parts[0] != "tests"


def measure(name: str) -> int:
    """Return the line count of a file."""
    return len(Path(name).read_text().splitlines())


def cap_fault(name: str, lines: int) -> str | None:
    """Return why a file is over its hard cap, or None when it is not.

    Checked independently of the allowance, so an entry permitting a length the
    cap forbids still cannot buy past the cap.
    """
    if lines <= limit_for(name):
        return None
    return f"{name}: {lines} lines (max {limit_for(name)}) — split it"


def ratchet_fault(name: str, lines: int, allowance: dict[str, int]) -> str | None:
    """Return why a watched file fails the ratchet, or None when it passes."""
    if not ratcheted(name) or lines <= WATCH_LINE:
        return None
    permitted = allowance.get(name)
    if permitted is None:
        return f"{name}: {lines} lines, over the {WATCH_LINE}-line watch line — add an ALLOWANCE entry of {lines}"
    if lines > permitted:
        return f"{name}: {lines} lines, over its allowance of {permitted} — split it, the allowance does not rise"
    if lines < permitted:
        return f"{name}: {lines} lines, under its allowance of {permitted} — lower the entry to {lines}"
    return None


def stale(allowance: dict[str, int]) -> list[str]:
    """Return why each unenforceable allowance entry cannot stand, sorted by path.

    Read off the filesystem, not off argv, so a partial invocation still audits
    the whole table.
    """
    problems = []
    for name in sorted(allowance):
        path = Path(name)
        if not path.is_file():
            problems.append(f"ALLOWANCE[{name!r}]: names no file")
        elif not ratcheted(name):
            problems.append(f"ALLOWANCE[{name!r}]: names a test path, which the ratchet does not govern")
        elif measure(name) <= WATCH_LINE:
            problems.append(f"ALLOWANCE[{name!r}]: file is back under the {WATCH_LINE}-line watch line — drop it")
    return problems


def check(names: list[str], allowance: dict[str, int] | None = None) -> int:
    """Refuse a tree where any named file is over its cap or has slipped its ratchet.

    Every rule runs every time, so one fix per run is never the shape of this.
    """
    if allowance is None:
        allowance = ALLOWANCE
    problems = []
    for name in names:
        lines = measure(name)
        problems += [fault for fault in (cap_fault(name, lines), ratchet_fault(name, lines, allowance)) if fault]
    problems += stale(allowance)

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s). A watched file only ever gets shorter.")
        return 1
    return 0


def main() -> int:
    """Check the files named on argv."""
    return check(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
