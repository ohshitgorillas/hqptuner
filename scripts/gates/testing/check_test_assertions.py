#!/usr/bin/env python3
"""Gate: the assertion shapes docs/spec/testing.md rule 2 and the Markers section forbid.

One finding is a ``(category, location)`` pair:

  zero         a test function holds no assertion. An assertion is an
               ``assert`` statement or a ``pytest.raises(...)`` context.
  conjunction  an ``assert`` in a test whose condition is a boolean ``and`` or
               ``or`` at its root, looking through a leading ``not``.
  loop         an assertion inside a ``for`` or ``while``, or an ``assert`` whose
               root is ``all()``/``any()``: an unparametrized case sweep.
  outside      an ``assert`` in a module-level function that is not a test,
               fixtures included. Helpers return evidence; fixtures that must
               refuse raise.
  skip         a ``skip``, ``skipif`` or ``xfail`` decorator on a test, or a
               ``pytest.skip``/``pytest.xfail`` call in its body.

How many assertions a test holds past the first, existence-only assertions and
private-attribute access belong to filepawl's ``claims``, ``existence`` and
``private`` gates, not to this one. Shape checks read the root of each condition
and nothing deeper, so a conjunction that is an operand of a comparison passes.
Functions nested inside a test are not scanned: a gate defeated by wrapping the
assert in a closure is not a gate, and the fix is to keep the assert at the call
site.

Sites allowed to stand say why in ``EXEMPT``, keyed ``<path>::<test name>``,
each owner-approved; the table covers the ``skip`` category only.

Usage: ``check_test_assertions.py [--report] <test files>``. ``--report`` prints
the findings and exits 0, for sizing; without it any finding fails the gate.
"""

import ast
import sys
from collections.abc import Iterator
from pathlib import Path

Finding = tuple[str, str]

#: ``<path>::<test name>`` to the owner-approved reason a skip or xfail stands.
EXEMPT: dict[str, str] = {}

_FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)
_LOOPS = (ast.For, ast.AsyncFor, ast.While)
_SKIP_MARKS = frozenset({"skip", "skipif", "xfail"})
_SKIP_CALLS = frozenset({"skip", "xfail"})
_SWEEPS = frozenset({"all", "any"})


def _is_raises(node: ast.AST) -> bool:
    if not isinstance(node, (ast.With, ast.AsyncWith)):
        return False
    for item in node.items:
        call = item.context_expr
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "raises":
            return True
    return False


def _root(expr: ast.expr) -> ast.expr:
    """Return the condition under any leading ``not``."""
    while isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
        expr = expr.operand
    return expr


def _is_sweep(expr: ast.expr) -> bool:
    return isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id in _SWEEPS


def _assertions(body: list[ast.stmt], *, in_loop: bool = False) -> Iterator[tuple[ast.stmt, bool]]:
    """Yield every assertion in ``body`` with whether a loop encloses it.

    Does not descend into nested function definitions.
    """
    for node in body:
        if isinstance(node, _FUNCS):
            continue
        if isinstance(node, ast.Assert) or _is_raises(node):
            yield node, in_loop
        inner_loop = in_loop or isinstance(node, _LOOPS)
        for field in ("body", "orelse", "finalbody", "handlers"):
            children = getattr(node, field, [])
            if children:
                yield from _assertions(children, in_loop=inner_loop)


def _own_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Every node under ``node`` except those inside a nested function."""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, _FUNCS):
            continue
        yield child
        yield from _own_nodes(child)


def _is_skip_mark(decorator: ast.expr) -> bool:
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    if not isinstance(target, ast.Attribute) or target.attr not in _SKIP_MARKS:
        return False
    owner = target.value
    if isinstance(owner, ast.Attribute):
        return owner.attr == "mark"
    return isinstance(owner, ast.Name) and owner.id == "mark"


def _is_skip_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
        return False
    owner = node.func.value
    return node.func.attr in _SKIP_CALLS and isinstance(owner, ast.Name) and owner.id == "pytest"


def _is_skipped(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(_is_skip_mark(d) for d in fn.decorator_list) or any(_is_skip_call(n) for n in _own_nodes(fn))


def _shape_categories(node: ast.stmt, *, in_loop: bool) -> list[str]:
    """Return the categories one assertion falls in: ``conjunction`` and ``loop``."""
    categories = []
    root = _root(node.test) if isinstance(node, ast.Assert) else None
    if isinstance(root, ast.BoolOp):
        categories.append("conjunction")
    if in_loop or (root is not None and _is_sweep(root)):
        categories.append("loop")
    return categories


def _test_findings(path: Path, fn: ast.FunctionDef | ast.AsyncFunctionDef, exempt: dict[str, str]) -> list[Finding]:
    where = f"{path}:{fn.lineno} {fn.name}"
    assertions = list(_assertions(fn.body))
    categories = [] if assertions else ["zero"]
    for node, in_loop in assertions:
        categories.extend(_shape_categories(node, in_loop=in_loop))
    if _is_skipped(fn) and f"{path}::{fn.name}" not in exempt:
        categories.append("skip")
    return [(category, where) for category in dict.fromkeys(categories)]


def _outside_findings(path: Path, fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[Finding]:
    return [("outside", f"{path}:{node.lineno} {fn.name}") for node in ast.walk(fn) if isinstance(node, ast.Assert)]


def _line_of(finding: Finding) -> int:
    return int(finding[1].rsplit(":", 1)[1].split(" ", 1)[0])


def check_file(path: Path, exempt: dict[str, str] | None = None) -> list[Finding]:
    """Return one finding per shape defect in ``path``, in line order.

    ``exempt`` defaults to ``EXEMPT``; a ``skip`` finding whose
    ``<path>::<name>`` is a key is not returned.
    """
    if exempt is None:
        exempt = EXEMPT
    tree = ast.parse(path.read_text(), filename=str(path))
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if isinstance(node, _FUNCS) and node.name.startswith("test_"):
            findings.extend(_test_findings(path, node, exempt))
    for node in tree.body:
        if isinstance(node, _FUNCS) and not node.name.startswith("test_"):
            findings.extend(_outside_findings(path, node))
    return sorted(findings, key=_line_of)


def main(argv: list[str] | None = None) -> int:
    """Refuse on any finding; with ``--report`` first, print the findings and return 0."""
    args = sys.argv[1:] if argv is None else argv
    report = args[:1] == ["--report"]
    findings = [finding for name in (args[1:] if report else args) for finding in check_file(Path(name))]
    for category, where in findings:
        print(f"{where}: {category}")
    return 0 if report or not findings else 1


if __name__ == "__main__":
    sys.exit(main())
