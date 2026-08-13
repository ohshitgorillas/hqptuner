#!/usr/bin/env python3
"""Gate: a split moves code, it does not leave a shell behind pointing at where the code went.

Two shapes, both of which make a file shorter without making the tree simpler,
and both of which read as a completed split to anything that only counts lines.

**Re-export module.** A file of imports and nothing else. Every caller keeps its
old import path, nothing was decoupled, and the module exists to be a name.
``__init__.py`` is skipped outright: re-exporting a package's surface is what it
is for, and the shape only lies in a file pretending to be a module of its own.
A module that defines constants defines something, so it is not this — only
``__all__`` is discounted, being the re-export's own manifest.

**Trivial forwarder.** ``def f(self, x): return self._other.f(x)``. The method
moved; the call sites did not. The surface of the class is unchanged, so no
caller was touched, so nothing was actually split — and the next agent to open
the file finds the same method count it had before.

The tell both share is that a caller-visible change did not happen. That is not
directly checkable, so this checks the two syntactic shapes it comes in.

Rule 2 does not apply under ``hqptuner/api/``. Route handlers are supposed to be
thin adapters between HTTP and a lane; a one-line handler is the correct shape
there and flagging it would bury the real hits.

A forwarder that has earned its place — reaching a collaborator that callers
have no other route to is a real job — goes in FORWARDER_EXEMPT with a reason a
human can weigh. A module that legitimately defines nothing goes in
MODULE_EXEMPT the same way. Both lists are audited against the filesystem rather
than against the paths on argv, because pre-commit hands this gate only the
files being committed and an argv-based audit would call every untouched
exemption stale on every partial commit. An entry excusing nothing fails, so an
exemption cannot outlive the thing it excused.

Two shapes rule 2 knowingly does not catch, because widening it to reach them
cost more false positives than the hits were worth: a forwarder that passes an
argument by keyword (``self.other.f(data, scope=scope)``), and one whose chain
is rooted in a call rather than a name (``self.require_http().restore(...)``).
Those are left to review and to the caller-delta rule in CLAUDE.md. A gate that
implied it caught every barrel would be worse than one that says where it stops.

Usage: ``python scripts/gates/check_no_barrels.py <path>...``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

#: Packages whose functions are checked for rule 2. api/ is deliberately absent.
FORWARDER_SCOPE = (
    "hqptuner/core/",
    "hqptuner/lanes/",
    "hqptuner/presets/",
    "hqptuner/engine/",
    "hqptuner/conf/",
)

#: Module to the reason it defines nothing on purpose. Empty is the healthy
#: state: a module that runs on import still assigns something, and one that
#: re-exports a package's surface is spelled ``__init__.py``, which is skipped.
MODULE_EXEMPT: dict[str, str] = {}

#: "path::function" to the reason that forwarder is the right shape after all.
FORWARDER_EXEMPT: dict[str, str] = {
    "hqptuner/presets/presetops.py::park_filter": "reaches the private filter park, which callers have no route to",
    "hqptuner/presets/presetops.py::parked_filter_members": "same park, same reason — the facade is the interface",
}


def named_all(node: ast.stmt) -> bool:
    """Report whether a statement assigns ``__all__``, which manifests a re-export rather than defining anything."""
    targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
    return any(isinstance(target, ast.Name) and target.id == "__all__" for target in targets)


def defines_something(tree: ast.Module) -> bool:
    """Report whether a module body defines a function, a class, or a constant of its own."""
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            return True
        if isinstance(node, ast.Assign | ast.AnnAssign) and not named_all(node):
            return True
    return False


def imports_anything(tree: ast.Module) -> bool:
    """Report whether a module body carries a runtime import statement."""
    return any(isinstance(node, ast.Import | ast.ImportFrom) for node in tree.body)


def is_reexport(name: str, tree: ast.Module) -> bool:
    """Report whether a file is imports and nothing else, which ``__init__.py`` is allowed to be."""
    if Path(name).name == "__init__.py":
        return False
    return imports_anything(tree) and not defines_something(tree)


def in_forwarder_scope(name: str) -> bool:
    """Report whether rule 2 governs a path."""
    return name.startswith(FORWARDER_SCOPE)


def sole_return(func: ast.FunctionDef | ast.AsyncFunctionDef) -> ast.expr | None:
    """Return the expression a function does nothing but return, or None if it does anything else.

    A leading docstring is allowed, since every function in this tree carries one
    and its presence says nothing about what the function does.
    """
    body = func.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        body = body[1:]
    if len(body) != 1 or not isinstance(body[0], ast.Return) or body[0].value is None:
        return None
    return body[0].value


def called(expr: ast.expr) -> ast.Call | None:
    """Return the call an expression is, seeing through a single await, or None."""
    if isinstance(expr, ast.Await):
        expr = expr.value
    return expr if isinstance(expr, ast.Call) else None


def chain_root(expr: ast.expr) -> str | None:
    """Return the name an attribute chain is rooted at, or None when it is not a plain chain."""
    while isinstance(expr, ast.Attribute):
        expr = expr.value
    return expr.id if isinstance(expr, ast.Name) else None


def parameters(func: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    """Return a function's positional parameter names, in order."""
    return [arg.arg for arg in func.args.posonlyargs + func.args.args]


def passes_through(func: ast.FunctionDef | ast.AsyncFunctionDef, call: ast.Call) -> bool:
    """Report whether a call hands on exactly this function's own parameters, in order.

    The receiver is dropped when the chain is rooted at the first parameter, so
    ``def f(self, x)`` forwarding as ``self._other.f(x)`` still matches: ``self``
    is spent on the chain rather than passed.
    """
    if call.keywords or any(isinstance(arg, ast.Starred) for arg in call.args):
        return False
    expected = parameters(func)
    if expected and chain_root(call.func) == expected[0]:
        expected = expected[1:]
    passed = [arg.id for arg in call.args if isinstance(arg, ast.Name)]
    return len(passed) == len(call.args) and passed == expected


def is_forwarder(func: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """Report whether a function is a bare pass-through to somewhere else."""
    returned = sole_return(func)
    call = called(returned) if returned is not None else None
    if call is None or not isinstance(call.func, ast.Attribute) or chain_root(call.func) is None:
        return False
    return passes_through(func, call)


def parsed(name: str) -> ast.Module | None:
    """Return a file's syntax tree, or None when there is no such file."""
    path = Path(name)
    return ast.parse(path.read_text()) if path.is_file() else None


def forwarders(name: str, tree: ast.Module) -> list[str]:
    """Return the ``path::function`` key of every pass-through in a parsed file."""
    walked = ast.walk(tree)
    return [
        f"{name}::{node.name}"
        for node in walked
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and is_forwarder(node)
    ]


def faults(name: str, exempt: dict[str, str], module_exempt: dict[str, str]) -> list[str]:
    """Return one file's problems."""
    tree = ast.parse(Path(name).read_text())
    problems = []
    if is_reexport(name, tree) and name not in module_exempt:
        problems.append(f"{name}: imports and defines nothing — a re-export module is not a split")
    if in_forwarder_scope(name):
        problems += [
            f"{key}: returns a call on its own arguments — move the callers, not the method"
            for key in forwarders(name, tree)
            if key not in exempt
        ]
    return problems


def stale_modules(module_exempt: dict[str, str]) -> list[str]:
    """Return a line for each module exemption excusing nothing, sorted by path."""
    problems = []
    for name in sorted(module_exempt):
        tree = parsed(name)
        if tree is None:
            problems.append(f"MODULE_EXEMPT[{name!r}]: names no file")
        elif not is_reexport(name, tree):
            problems.append(f"MODULE_EXEMPT[{name!r}]: the module defines something, so it needs no exemption")
    return problems


def stale_forwarders(exempt: dict[str, str]) -> list[str]:
    """Return a line for each forwarder exemption excusing nothing, sorted by key."""
    problems = []
    for key in sorted(exempt):
        name = key.partition("::")[0]
        tree = parsed(name)
        if tree is None:
            problems.append(f"FORWARDER_EXEMPT[{key!r}]: names no file")
        elif key not in forwarders(name, tree):
            problems.append(f"FORWARDER_EXEMPT[{key!r}]: matches no forwarder")
    return problems


def check(names: list[str], exempt: dict[str, str] | None = None, module_exempt: dict[str, str] | None = None) -> int:
    """Refuse files that were shortened by leaving a shell behind."""
    if exempt is None:
        exempt = FORWARDER_EXEMPT
    if module_exempt is None:
        module_exempt = MODULE_EXEMPT
    problems = []
    for name in names:
        problems += faults(name, exempt, module_exempt)
    problems += stale_modules(module_exempt) + stale_forwarders(exempt)

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s). A split that changed no caller did not happen.")
        return 1
    return 0


def main() -> int:
    """Check the files named on argv."""
    return check(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
