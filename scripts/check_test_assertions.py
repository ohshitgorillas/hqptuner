#!/usr/bin/env python3
"""Gate: every test function contains exactly one assertion (docs/testing.md).

An assertion is an `assert` statement or a `pytest.raises(...)` context.
Zero is a smoke test hiding as a test; more than one muddies failure
attribution; any assertion inside a loop is an unparametrized case sweep.
Helper functions nested inside a test are not scanned.
"""

import ast
import sys
from pathlib import Path

_FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)


def _is_raises(node: ast.With | ast.AsyncWith) -> bool:
    for item in node.items:
        call = item.context_expr
        if (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Attribute)
            and call.func.attr == "raises"
        ):
            return True
    return False


def _count_assertions(body: list[ast.stmt], in_loop: bool = False) -> tuple[int, bool]:
    """Return (assertion count, any-inside-loop) without descending into
    nested function definitions."""
    count, looped = 0, False
    for node in body:
        if isinstance(node, _FUNCS):
            continue
        hit = isinstance(node, ast.Assert) or (
            isinstance(node, (ast.With, ast.AsyncWith)) and _is_raises(node)
        )
        if hit:
            count += 1
            looped = looped or in_loop
        inner_loop = in_loop or isinstance(node, (ast.For, ast.AsyncFor, ast.While))
        for field in ("body", "orelse", "finalbody", "handlers"):
            children = getattr(node, field, [])
            if field == "handlers":
                children = [stmt for h in children for stmt in h.body]
            if children:
                sub_count, sub_looped = _count_assertions(children, inner_loop)
                count += sub_count
                looped = looped or sub_looped
    return count, looped


def check_file(path: Path) -> list[str]:
    problems = []
    tree = ast.parse(path.read_text(), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, _FUNCS) and node.name.startswith("test_"):
            count, looped = _count_assertions(node.body)
            if count != 1:
                problems.append(f"{path}:{node.lineno} {node.name}: {count} assertions (want 1)")
            elif looped:
                problems.append(f"{path}:{node.lineno} {node.name}: assert in loop, parametrize")
    return problems


def main() -> int:
    problems = [p for name in sys.argv[1:] for p in check_file(Path(name))]
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
