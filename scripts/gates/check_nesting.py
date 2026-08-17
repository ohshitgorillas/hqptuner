#!/usr/bin/env python3
"""Gate: no function nests blocks deeper than four levels.

xenon and ruff ``C901`` both measure cyclomatic complexity, which counts
branches and not indentation. A long function that is deeply nested but
branch-cheap scores fine under both and is still unreadable: every line in it
carries four or five conditions the reader has to hold at once. ``eslint.config.js``
enforces ``max-depth: 4`` over the frontend; this is the Python peer of that
rule.

A level is an ``if``, ``for``, ``while``, ``with``, ``try`` or ``match``, in
their async forms too. Two shapes deliberately do not add one. ``elif`` shares
its ``if``'s level, because a chain of arms is flat to a reader however many
there are — a plain ``else:`` containing an ``if`` is a real level, and is
counted. A nested ``def`` starts its own count rather than inheriting its
enclosing function's, because the reader of the inner function does not carry
the outer one's conditions; it is reported under its dotted name.

Sites that are allowed to stand say why in ``EXEMPT``, keyed
``path::qualified.name``. The mapping is audited against the filesystem rather
than against the paths handed over, so a partial commit that touches one file
is not told every other entry is stale, and an entry that has stopped being
true cannot hide by staying out of the run.

Usage: ``python scripts/gates/check_nesting.py <path>...``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

#: The deepest a function may nest. Matches eslint's `max-depth` for the frontend.
MAX_DEPTH = 4

#: ``path::qualified.name`` -> why this site is allowed to nest past the limit.
#: Per site, never per directory: a directory-wide entry excuses the next
#: offender nobody has read yet.
EXEMPT: dict[str, str] = {}

_BLOCKS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith, ast.Try, ast.TryStar, ast.Match)
_FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)

_Found = list[tuple[str, int, int]]


def _is_elif(node: ast.If, orelse: list[ast.stmt]) -> bool:
    """Report whether an ``if``'s ``else`` branch is really an ``elif``.

    The parser represents both as an ``If`` inside ``orelse``; only the column
    tells them apart, an ``elif`` starting where its ``if`` does.
    """
    return len(orelse) == 1 and isinstance(orelse[0], ast.If) and orelse[0].col_offset == node.col_offset


def _if_depth(node: ast.If, depth: int, prefix: str, found: _Found) -> int:
    """Return the deepest nesting inside an ``if``, its ``elif`` arms sharing its level."""
    inner = depth + 1
    deepest = _walk(node.body, inner, prefix, found)
    if _is_elif(node, node.orelse):
        arm = node.orelse[0]
        assert isinstance(arm, ast.If)
        return max(deepest, _if_depth(arm, depth, prefix, found))
    return max(deepest, _walk(node.orelse, inner, prefix, found))


def _block_depth(node: ast.stmt, depth: int, prefix: str, found: _Found) -> int:
    """Return the deepest nesting inside a block statement, which occupies one level itself."""
    if isinstance(node, ast.If):
        return _if_depth(node, depth, prefix, found)
    inner = depth + 1
    bodies = [getattr(node, name, []) for name in ("body", "orelse", "finalbody")]
    bodies += [handler.body for handler in getattr(node, "handlers", [])]
    bodies += [case.body for case in getattr(node, "cases", [])]
    return max(_walk(body, inner, prefix, found) for body in bodies)


def _statement_depth(node: ast.stmt, depth: int, prefix: str, found: _Found) -> int:
    """Return the deepest nesting a single statement reaches, recording any function it defines."""
    if isinstance(node, _FUNCS):
        _record(node, prefix, found)
        return depth
    if isinstance(node, ast.ClassDef):
        return _walk(node.body, depth, f"{prefix}{node.name}.", found)
    if isinstance(node, _BLOCKS):
        return _block_depth(node, depth, prefix, found)
    return depth


def _walk(body: list[ast.stmt], depth: int, prefix: str, found: _Found) -> int:
    """Return the deepest nesting a list of statements reaches, starting from ``depth``."""
    return max([depth, *(_statement_depth(node, depth, prefix, found) for node in body)])


def _record(node: ast.FunctionDef | ast.AsyncFunctionDef, prefix: str, found: _Found) -> None:
    """Append a function's measurement to ``found``, outermost first, then measure its body."""
    name = f"{prefix}{node.name}"
    slot = len(found)
    found.append((name, node.lineno, 0))
    found[slot] = (name, node.lineno, _walk(node.body, 0, f"{name}.", found))


def depths(source: str) -> _Found:
    """Return (qualified name, def line, deepest nesting) for every function in a module source, outermost first."""
    found: _Found = []
    _walk(ast.parse(source).body, 0, "", found)
    return found


def faults(name: str, exempt: dict[str, str]) -> list[str]:
    """Return one line per function in a file that nests past the limit without an exemption."""
    return [
        f"{name}:{line}: {func}() nests {depth} deep (max {MAX_DEPTH})"
        for func, line, depth in depths(Path(name).read_text())
        if depth > MAX_DEPTH and f"{name}::{func}" not in exempt
    ]


def _entry_fault(key: str) -> str | None:
    """Return why one exemption entry cannot stand, or None when it is still earning its place."""
    name, _, func = key.partition("::")
    path = Path(name)
    if not path.is_file():
        return f"EXEMPT[{key!r}]: names no file"
    measured = {found: depth for found, _, depth in depths(path.read_text())}
    if func not in measured:
        return f"EXEMPT[{key!r}]: names no function in {name} — drop it"
    if measured[func] <= MAX_DEPTH:
        return f"EXEMPT[{key!r}]: nests {measured[func]} deep, within the limit of {MAX_DEPTH} — drop it"
    return None


def stale(exempt: dict[str, str]) -> list[str]:
    """Return why each unenforceable exemption cannot stand, sorted by key.

    Read off the filesystem, not off argv, so a partial invocation still audits
    the whole mapping.
    """
    return [fault for fault in (_entry_fault(key) for key in sorted(exempt)) if fault]


def check(names: list[str], exempt: dict[str, str] | None = None) -> int:
    """Refuse a tree where a named file has a function nesting past MAX_DEPTH without an EXEMPT entry."""
    if exempt is None:
        exempt = EXEMPT
    problems = [fault for name in names for fault in faults(name, exempt)]
    problems += stale(exempt)

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s). Flatten the function, or add an EXEMPT entry saying why it stands.")
        return 1
    return 0


def main() -> int:
    """Check the files named on argv."""
    return check(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
