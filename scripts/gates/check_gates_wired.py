#!/usr/bin/env python3
"""Gate: every gate script in ``scripts/gates/`` runs in the Makefile and in pre-commit.

Each gate is wired in by hand, one line per script, and nothing else notices
when a script never acquires that line — or keeps it after a target is
rewritten. An uninvoked gate stops running, and a gate that stops running rots
silently: it can drift all the way to crashing on import while ``make check``
stays green.

There are two wirings, not one. ``make check`` is run by hand; pre-commit runs
on every commit. A gate present in the first and absent from the second still
looks wired, and the two have drifted apart before. Absence from pre-commit can
be correct — a gate too slow for the commit path belongs in ``make check``
only — but nothing distinguished a deliberate absence from a forgotten one,
because both are spelled as silence.

So Makefile wiring is mandatory with no exemption: a gate that should not run
is a gate that should be deleted. Pre-commit wiring is mandatory *or* exempt,
and an exemption is a line of prose in ``PRECOMMIT_EXEMPT`` saying why. An
exemption naming no gate is itself a failure — a stale reason is the same drift
one layer up. This file polices itself: its own filename in both configs is
what satisfies its own rule.

Usage: ``python scripts/gates/check_gates_wired.py``
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: Gates that run in the Makefile only, filename to the reason they stay off the
#: commit path. Empty is the healthy state: every gate measured so far is fast
#: enough for pre-commit, including the two that shell out to node.
PRECOMMIT_EXEMPT: dict[str, str] = {}


def gate_scripts(gates: Path) -> list[str]:
    """Filename of every gate script in the directory, sorted."""
    return sorted(path.name for path in gates.glob("*.py") if path.is_file())


def live(text: str) -> str:
    """Drop comment lines, which wire nothing.

    A gate commented out is a gate that stopped running, which is the case this
    exists to catch. Both configs mark comments with ``#``.
    """
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def unwired(config: str, names: list[str]) -> list[str]:
    """Return the gates whose filename appears in no live line of ``config``."""
    body = live(config)
    return [name for name in names if name not in body]


def stale(names: list[str], exempt: dict[str, str]) -> list[str]:
    """Return exemption keys naming no gate script, sorted."""
    return sorted(key for key in exempt if key not in names)


def check(root: Path, exempt: dict[str, str] | None = None) -> int:
    """Refuse a gate that no live Makefile recipe invokes, or that pre-commit forgot.

    Both checks run every time: a tree failing one still reports the other, so
    one fix per run is never the shape of this.
    """
    if exempt is None:
        exempt = PRECOMMIT_EXEMPT
    names = gate_scripts(root / "scripts" / "gates")
    problems = 0

    for name in unwired((root / "Makefile").read_text(), names):
        print(f"scripts/gates/{name}: no Makefile target invokes it")
        problems += 1
    precommit = (root / ".pre-commit-config.yaml").read_text()
    for name in unwired(precommit, [n for n in names if n not in exempt]):
        print(f"scripts/gates/{name}: not in .pre-commit-config.yaml and not exempt")
        problems += 1
    for name in stale(names, exempt):
        print(f"PRECOMMIT_EXEMPT[{name!r}]: names no gate script")
        problems += 1

    if problems:
        print(f"\n{problems} problem(s). Every gate runs in a live Makefile recipe, and in")
        print(".pre-commit-config.yaml unless PRECOMMIT_EXEMPT gives a reason it should not.")
        return 1
    print(f"[ok] all {len(names)} gate scripts are wired into the Makefile and pre-commit")
    return 0


def main() -> int:
    """Check this repo."""
    return check(ROOT)


if __name__ == "__main__":
    sys.exit(main())
