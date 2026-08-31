#!/usr/bin/env python3
"""Gate: a test never asserts a string it did not put on the wire itself (docs/testing.md rule 9).

A sentence inside an ``assert`` or a ``pytest.raises(match=...)`` is copy unless
the test file itself seeded it somewhere outside an assertion: a fixture body, a
fake's reply, a request payload. Copy is owner-owned data, reworded at will, and
a test pinning it goes red on a rewording and green on a broken behavior. The
mechanical shape caught here is a literal of two or more words in an assertion
position; the principle behind it is what review checks.

Usage: ``check_no_copy_assertions.py [--report] <test files>``. ``--report``
prints the findings and a count per category and exits 0, for sizing a
migration; without it any finding fails the gate.
"""

from __future__ import annotations

import ast
import re
import sys
from collections import Counter
from pathlib import Path

#: Two alphabetic words separated by a space: the shape of prose, not of an identifier.
PROSE = re.compile(r"[A-Za-z]{2,} [A-Za-z]{2,}")
#: Wire shapes that happen to contain spaces: XML frames, key=value, JSON bodies.
WIRE = re.compile(r"[<=>{}]")


def _is_prose(text: str) -> bool:
    return bool(PROSE.search(text)) and not WIRE.search(text)


def _strings(node: ast.AST) -> list[ast.Constant]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _raises_match(node: ast.Call) -> ast.expr | None:
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "raises"):
        return None
    return next((kw.value for kw in node.keywords if kw.arg == "match"), None)


def _asserted(tree: ast.Module) -> tuple[list[tuple[int, str, str]], set[int]]:
    """Return (lineno, category, text) for every string in an assertion position, and the ids of those nodes."""
    found: list[tuple[int, str, str]] = []
    seen: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert):
            target: ast.AST | None = node.test
            category = "assert-literal"
        elif isinstance(node, ast.Call):
            target = _raises_match(node)
            category = "raises-match"
        else:
            continue
        if target is None:
            continue
        for sub in _strings(target):
            seen.add(id(sub))
            found.append((sub.lineno, category, str(sub.value)))
    return found, seen


def check_file(path: Path) -> list[tuple[str, str]]:
    """Return (category, location) for each prose literal asserted but never seeded by the file."""
    tree = ast.parse(path.read_text(), filename=str(path))
    asserted, seen = _asserted(tree)
    seeded = {n.value for n in _strings(tree) if id(n) not in seen}
    return [
        (category, f"{path}:{lineno} {category}: {text!r}")
        for lineno, category, text in asserted
        if _is_prose(text) and text not in seeded
    ]


def main(argv: list[str]) -> int:
    """Refuse a test asserting prose it did not seed; with --report, count and pass."""
    report = "--report" in argv
    findings = [f for name in argv if name != "--report" for f in check_file(Path(name))]
    for _, line in findings:
        print(line)
    if report:
        for category, count in sorted(Counter(c for c, _ in findings).items()):
            print(f"{category}: {count} site(s)")
        print(f"copy assertions: {len(findings)} total (report only)")
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
