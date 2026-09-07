#!/usr/bin/env python3
r"""Gate: a spec block's items carry their clauses.

In draft mode the string shapes the spec-reviewer cuts on sight are reported
before the reviewer is spawned, so a string shape never costs a round.

A block is read above its reviewer section, which starts at the first line
matching ``^(---\s*)?spec-reviewer`` case-insensitively; a file with no such
line is read whole. An item starts at a line matching ``^\s*N. ``. A clause is
a following line whose stripped text starts with ``kills:``, ``bite:``,
``existing:``, ``rule:`` or ``assertion:``. Any other line folds into the
clause before it, or into the item's outcome sentence when no clause has
started yet, so a soft-wrapped item is one item.

Both modes, per item: the first clause is ``kills:`` (behavior) or ``rule:``
(excision). Draft mode (default) adds, per behavior item: an outcome carrying one of the words
the spec-reviewer cuts under (h) and (i); a missing ``kills:``, ``bite:`` or
``existing:``; an ``existing:`` naming a ``tests/`` path with no ``::`` (an
``existing: none (<grep>)`` is exempt, the grep being the evidence); a
``bite:`` that names neither a parenthesised command nor a stub. Per excision
item: a missing ``rule:`` or ``assertion:``. One report line per flagged
source line, ``<file>:<line>: <reasons>``.

Committed mode (``--committed``) runs the clause-order check alone. Wired over ``tests/specs/`` in
the Makefile and pre-commit; the word checks stay in draft mode because an
approved block may legitimately carry them.

Usage: ``python scripts/gates/check_spec_draft.py [--committed] FILE...``
Exit 1 on any flag, or on an empty file; 0 otherwise, including no files.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SECTION = re.compile(r"^(---\s*)?spec-reviewer", re.IGNORECASE)
ITEM = re.compile(r"^\s*(\d+)\.\s")
CLAUSES = ("kills:", "bite:", "existing:", "rule:", "assertion:")
WORDS = (
    " and ",
    "leaves",
    "unchanged",
    "no longer",
    " not ",
    "correctly",
    "properly",
    "as expected",
    "handles",
    "round-trips",
    "applies",
    "works",
)
TEST_PATH = re.compile(r"tests/\S+")
Flag = tuple[int, str]


class Item:
    """One numbered item: its line, its outcome sentence and its clauses in order."""

    def __init__(self, line: int, head: str) -> None:
        """Start an item at ``line`` from its first source line ``head``."""
        self.line = line
        self.outcome = head
        self.clauses: list[tuple[int, str, str]] = []
        self.excision = head.lstrip().split(" ", 1)[1].startswith("excise")

    def clause(self, name: str) -> tuple[int, str, str] | None:
        """Return the first clause named ``name`` as ``(line, name, body)``, or None."""
        return next((c for c in self.clauses if c[1] == name), None)

    def extend(self, text: str) -> None:
        """Fold a continuation line into the last clause, or the outcome."""
        if self.clauses:
            line, name, body = self.clauses[-1]
            self.clauses[-1] = (line, name, body + " " + text.strip())
        else:
            self.outcome += " " + text.strip()


def parse(text: str) -> list[Item]:
    """Return the items above the reviewer section, clauses attached."""
    items: list[Item] = []
    for number, raw in enumerate(text.splitlines(), 1):
        if SECTION.match(raw):
            break
        stripped = raw.strip()
        if ITEM.match(raw):
            items.append(Item(number, raw))
        elif not items or not stripped:
            continue
        elif stripped.startswith(CLAUSES):
            name, _, body = stripped.partition(":")
            items[-1].clauses.append((number, name + ":", body.strip()))
        else:
            items[-1].extend(raw)
    return items


def _behavior_flags(item: Item) -> list[Flag]:
    flags: list[Flag] = []
    outcome = item.outcome.lower()
    hits = [w for w in WORDS if w in outcome]
    if hits:
        flags.append((item.line, "outcome carries " + ", ".join(repr(w) for w in hits)))
    required = ("kills:", "bite:", "existing:")
    flags.extend((item.line, f"missing {name}") for name in required if item.clause(name) is None)
    existing = item.clause("existing:")
    if existing and not existing[2].startswith("none") and TEST_PATH.search(existing[2]) and "::" not in existing[2]:
        flags.append((existing[0], "existing: names a file, not a test"))
    bite = item.clause("bite:")
    if bite and "(" not in bite[2] and "stub" not in bite[2].lower():
        flags.append((bite[0], "bite: names neither a command nor a stub"))
    return flags


def _excision_flags(item: Item) -> list[Flag]:
    return [(item.line, f"missing {name}") for name in ("rule:", "assertion:") if item.clause(name) is None]


def _committed_flags(item: Item) -> list[Flag]:
    want = "rule:" if item.excision else "kills:"
    first = item.clauses[0][1] if item.clauses else None
    return [] if first == want else [(item.line, f"first clause is {first or 'absent'}, not {want}")]


def check(text: str, *, committed: bool) -> list[Flag]:
    """Every flag for one block's text, as ``(line, reason)`` pairs."""
    if not text.strip():
        return [(0, "no lines")]
    flags: list[Flag] = []
    for item in parse(text):
        flags += _committed_flags(item)
        if committed:
            continue
        flags += _excision_flags(item) if item.excision else _behavior_flags(item)
    return flags


def report(path: Path, flags: list[Flag]) -> None:
    """Print one ``<path>:<line>: <reasons>`` line per flagged source line."""
    merged: dict[int, list[str]] = {}
    for line, reason in flags:
        merged.setdefault(line, []).append(reason)
    for line in sorted(merged):
        print(f"{path}:{line}: {'; '.join(merged[line])}")


def main(argv: list[str] | None = None) -> int:
    """Check every file named in ``argv`` (default ``sys.argv[1:]``); 1 if any flagged, else 0."""
    argv = sys.argv[1:] if argv is None else argv
    committed = "--committed" in argv
    failed = False
    for path in (Path(a) for a in argv if a != "--committed"):
        flags = check(path.read_text(encoding="utf-8"), committed=committed)
        report(path, flags)
        failed = failed or bool(flags)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
