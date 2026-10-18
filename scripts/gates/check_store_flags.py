#!/usr/bin/env python3
"""Gate: a per-field flag naming a store to prefer is refused under ``hqptuner/static/``.

The server says which store answers a field, and the client keeps no copy of
that rule. The gate scans the text of each file it is handed under
``hqptuner/static/`` and refuses, one problem per hit, opening with
``<path>:<line>:`` and naming what it found:

- the flag ``fileTruth`` and the flag ``appliesLive``, as whole identifiers;
- a priority list of sources, spelled as one array literal whose every element
  is a quoted store name, ``"engine"``, ``"file"`` or ``"staged"``, two or more
  of them in any order, such as ``["staged", "file", "engine"]``.

The scan is plain text: it imports nothing from the package and reads no
syntax tree.

Usage: ``python scripts/gates/check_store_flags.py $(git ls-files 'hqptuner/static/*.js')``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

#: The tree the gate judges, as a run of path components.
JUDGED = ("hqptuner", "static")

#: A refused flag, standing alone as an identifier.
FLAG = re.compile(r"(?<![\w$])(fileTruth|appliesLive)(?![\w$])")

#: One quoted store name, in either quote.
STORE = r"""\s*(?:"(?:engine|file|staged)"|'(?:engine|file|staged)')\s*"""

#: An array literal holding only store names, two or more of them.
PRIORITY_LIST = re.compile(rf"\[{STORE}(?:,{STORE})+,?\s*\]")


def judged(path: Path) -> bool:
    """Whether the file sits under ``hqptuner/static/``."""
    parts = path.parts
    return any(parts[i : i + len(JUDGED)] == JUDGED for i in range(len(parts)))


def check_file(path: Path) -> list[str]:
    """Every refused flag and priority list in one file, in source order."""
    text = path.read_text(encoding="utf-8")
    hits = [(match.start(), f"store flag {match.group(1)}") for match in FLAG.finditer(text)]
    hits += [(match.start(), "priority list of sources") for match in PRIORITY_LIST.finditer(text)]
    return [f"{path}:{text.count(chr(10), 0, start) + 1}: {what}" for start, what in sorted(hits)]


def report(problems: list[str]) -> int:
    """Print every problem and the rule they break; return the exit code."""
    for problem in problems:
        print(problem, file=sys.stderr)
    if not problems:
        return 0
    print(
        f"\n{len(problems)} store flag(s) under hqptuner/static/; the server says which store answers"
        " a field, and the client keeps no copy of that rule",
        file=sys.stderr,
    )
    return 1


def main(argv: list[str]) -> int:
    """Refuse any store flag or priority list in the files handed over that the gate judges."""
    return report(
        [problem for path in map(Path, argv) if path.is_file() and judged(path) for problem in check_file(path)]
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
