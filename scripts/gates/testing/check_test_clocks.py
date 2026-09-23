#!/usr/bin/env python3
"""Gate: no test outside ``tests/e2e/`` sleeps on a real clock or holds a small real deadline.

Two patterns, one AST pass.

A ``time.sleep`` or ``asyncio.sleep`` call is flagged unless its argument is the
literal ``0``, which is a scheduler yield rather than a wait. Anything else is
flagged, literal or not: the house spelling for a wait is often a module constant
or an attribute, and a literal-only match reads a paced fake as clean.

A ``timeout`` or ``*_timeout`` keyword or mapping key given a numeric literal
above zero and below SMALL is flagged. Every such knob in the tree is either a ceiling a test
never reaches, at seconds, or a deadline the code waits out, at a fraction of a
second; the value is what separates them.

``tests/e2e/`` is excluded, where a real clock is allowed by ``docs/testing.md``.

A per-test duration threshold cannot see either pattern: a ten millisecond poll
spread over seventy call sites lifts no test over any threshold, and a deadline
waited out in a portal thread reads as CPU rather than as idle.

Usage: ``python scripts/gates/testing/check_test_clocks.py <file>...``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

#: Seconds below which a real deadline is a wait rather than a ceiling.
SMALL = 0.5

#: The tree where a real clock is allowed, by docs/testing.md.
CARVE_OUT = "tests/e2e/"


def excluded(name: str) -> bool:
    """Return whether the path lies in the carve-out."""
    return CARVE_OUT in Path(name).as_posix()


def _sleeps(node: ast.Call) -> bool:
    """Return whether the call is a real-clock sleep, by the module it is called on.

    ``time`` and ``asyncio`` are the two modules that hold a real clock. A
    ``.sleep`` on anything else is a seam the test controls — the manager's
    clock is the one in this tree — and waits on no clock at all.
    """
    func = node.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "sleep"
        and isinstance(func.value, ast.Name)
        and func.value.id in ("time", "asyncio")
    )


def _waits(node: ast.Call) -> bool:
    """Return whether a sleep call waits, rather than yielding to the scheduler."""
    if not node.args:
        return False
    first = node.args[0]
    return not (isinstance(first, ast.Constant) and isinstance(first.value, (int, float)) and first.value == 0)


def _deadline(name: str | None, value: ast.expr) -> bool:
    """Return whether a name and its value are a small real deadline.

    Zero is no deadline: it is the spelling for a socket or a route that
    returns on the first pass, and it waits on nothing, as ``sleep(0)`` does.
    """
    if name is None or not (name == "timeout" or name.endswith("_timeout")):
        return False
    return isinstance(value, ast.Constant) and isinstance(value.value, (int, float)) and 0 < value.value < SMALL


def _call_faults(name: str, node: ast.Call) -> list[str]:
    """Return one line per real clock a call holds: its own wait, and its deadline keywords."""
    found = [f"{name}:{node.lineno}: sleeps on a real clock"] if _sleeps(node) and _waits(node) else []
    found += [
        f"{name}:{keyword.value.lineno}: {keyword.arg}= is a real deadline under {SMALL}s"
        for keyword in node.keywords
        if _deadline(keyword.arg, keyword.value)
    ]
    return found


def _mapping_faults(name: str, node: ast.Dict) -> list[str]:
    """Return one line per deadline a mapping literal carries under a string key."""
    pairs = zip(node.keys, node.values, strict=True)
    return [
        f"{name}:{key.lineno}: {key.value!r} is a real deadline under {SMALL}s"
        for key, value in pairs
        if isinstance(key, ast.Constant) and isinstance(key.value, str) and _deadline(key.value, value)
    ]


def faults(name: str, source: str) -> list[str]:
    """Return one line per real clock in a module source."""
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            found += _call_faults(name, node)
        elif isinstance(node, ast.Dict):
            found += _mapping_faults(name, node)
    return sorted(found)


def check(names: list[str]) -> int:
    """Refuse a tree where a named file outside the carve-out holds a real clock."""
    problems = [problem for name in names if not excluded(name) for problem in faults(name, Path(name).read_text())]
    for problem in problems:
        print(problem)
    if problems:
        print(
            f"\n{len(problems)} real clock(s) under tests/. A poll waits on a condition and a deadline"
            " comes from a seam the test controls; docs/testing.md rule 7 is the rule."
        )
        return 1
    return 0


def main() -> int:
    """Check the files named on argv."""
    return check(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
