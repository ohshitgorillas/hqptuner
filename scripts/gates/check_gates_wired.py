#!/usr/bin/env python3
"""Gate: every gate script in ``scripts/gates/`` is invoked by the Makefile.

Each gate is wired in by hand, one line per script, and nothing else notices
when a script never acquires that line — or keeps it after a target is
rewritten. An uninvoked gate stops running, and a gate that stops running rots
silently: it can drift all the way to crashing on import while ``make check``
stays green.

Every script in the directory is mandatory. There is no exemption marker: a
gate that should not run is a gate that should be deleted. This file polices
itself — its own filename in the Makefile is what satisfies its own rule.

Usage: ``python scripts/gates/check_gates_wired.py``
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
GATES = ROOT / "scripts" / "gates"
MAKEFILE = ROOT / "Makefile"


def gate_scripts() -> list[str]:
    """Filename of every gate script in the directory, sorted."""
    return sorted(path.name for path in GATES.glob("*.py") if path.is_file())


def unwired(makefile: str, names: list[str]) -> list[str]:
    """Return the gates whose filename appears in no Makefile recipe.

    Comment lines do not count: a gate commented out is a gate that stopped
    running, which is the case this exists to catch.
    """
    live = "\n".join(line for line in makefile.splitlines() if not line.lstrip().startswith("#"))
    return [name for name in names if name not in live]


def main() -> int:
    names = gate_scripts()
    problems = unwired(MAKEFILE.read_text(), names)
    for name in problems:
        print(f"scripts/gates/{name}: no Makefile target invokes it")
    if problems:
        print(f"\n{len(problems)} gate script(s) never run. Add each to a Makefile target,")
        print("or delete the script — every gate in scripts/gates/ is mandatory.")
        return 1
    print(f"[ok] all {len(names)} gate scripts are wired into the Makefile")
    return 0


if __name__ == "__main__":
    sys.exit(main())
