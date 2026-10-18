#!/usr/bin/env python3
"""Gate: the lifecycle's retired names and a new ``asyncio.Event`` on ``ConnectionManager`` are refused.

The gate reads each Python file it is handed as a syntax tree and refuses
``reachable``, ``connected``, ``ready``, ``http_ok``, ``connects``, ``drops``,
``drops_at_connect`` and ``restart_landed`` wherever code uses one as an
attribute, a parameter or a comparand, one problem per use, opening with
``<path>:<line>:`` and naming what it found. ``hqptuner/core/lifecycle.py``
owns the lifecycle and is spared. A word inside a string, a docstring or a
comment is text, not code, and is not reported.

In ``hqptuner/core/manager.py`` the gate also refuses every ``asyncio.Event``
the ``ConnectionManager`` class builds, on the class or on an instance, except
``changed``: the one wake event the lifecycle module owns and the manager
exposes.

Usage: ``python scripts/gates/check_lifecycle_names.py $(git ls-files 'hqptuner/*.py' 'tests/*.py')``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

#: The names the lifecycle retires outside its own module.
RETIRED = frozenset(
    {"reachable", "connected", "ready", "http_ok", "connects", "drops", "drops_at_connect", "restart_landed"}
)

#: The lifecycle module, as the path components it ends with.
LIFECYCLE_MODULE = ("hqptuner", "core", "lifecycle.py")

#: The connection manager's module, as the path components it ends with.
MANAGER_MODULE = ("hqptuner", "core", "manager.py")

#: The class whose events the gate counts.
MANAGER_CLASS = "ConnectionManager"

#: The events the manager may hold: the lifecycle's own wake event.
ALLOWED_EVENTS = frozenset({"changed"})

#: The spellings of a call that builds an event.
EVENT_CALLS = frozenset({"asyncio.Event", "Event"})

#: One use the gate found: its line, then what it is.
Hit = tuple[int, str]


def ends_with(path: Path, tail: tuple[str, ...]) -> bool:
    """Whether ``path`` ends with the path components ``tail``."""
    return path.parts[-len(tail) :] == tail


def attribute_uses(nodes: list[ast.AST]) -> list[Hit]:
    """Every retired name read or set as an attribute."""
    return [(node.lineno, f"attribute {node.attr}") for node in nodes if isinstance(node, ast.Attribute)]


def parameter_uses(nodes: list[ast.AST]) -> list[Hit]:
    """Every retired name declared as a parameter."""
    return [(node.lineno, f"parameter {node.arg}") for node in nodes if isinstance(node, ast.arg)]


def comparand_uses(nodes: list[ast.AST]) -> list[Hit]:
    """Every bare name a comparison reads."""
    operands = [
        operand for node in nodes if isinstance(node, ast.Compare) for operand in (node.left, *node.comparators)
    ]
    return [(operand.lineno, f"comparand {operand.id}") for operand in operands if isinstance(operand, ast.Name)]


def retired_uses(tree: ast.AST) -> list[Hit]:
    """Every retired name used as an attribute, a parameter or a comparand."""
    nodes = list(ast.walk(tree))
    hits = attribute_uses(nodes) + parameter_uses(nodes) + comparand_uses(nodes)
    return [hit for hit in hits if hit[1].split()[-1] in RETIRED]


def event_hit(node: ast.AST) -> list[Hit]:
    """Report the new event an assignment binds, on a class or off ``self``, unless it is the wake event."""
    if not isinstance(node, (ast.Assign, ast.AnnAssign)) or not isinstance(node.value, ast.Call):
        return []
    target = node.targets[0] if isinstance(node, ast.Assign) else node.target
    name = str(getattr(target, "id", getattr(target, "attr", "")))
    if ast.unparse(node.value.func) not in EVENT_CALLS or name in ALLOWED_EVENTS:
        return []
    return [(node.lineno, f"new asyncio.Event {name} on {MANAGER_CLASS}")]


def manager_nodes(tree: ast.AST) -> list[ast.AST]:
    """Every node inside the manager class."""
    classes = [node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == MANAGER_CLASS]
    return [node for cls in classes for node in ast.walk(cls)]


def new_events(tree: ast.AST) -> list[Hit]:
    """Every event the manager class builds under a name other than its wake event."""
    return [hit for node in manager_nodes(tree) for hit in event_hit(node)]


def check_file(path: Path) -> list[str]:
    """Every refused use in one file, in line order."""
    if ends_with(path, LIFECYCLE_MODULE):
        return []
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    hits = retired_uses(tree) + (new_events(tree) if ends_with(path, MANAGER_MODULE) else [])
    return [f"{path}:{line}: {what}" for line, what in sorted(hits)]


def report(problems: list[str]) -> int:
    """Print every problem and the rule they break; return the exit code."""
    for problem in problems:
        print(problem, file=sys.stderr)
    if not problems:
        return 0
    print(
        f"\n{len(problems)} retired lifecycle name(s) or new manager event(s); read the phase and the"
        " generation off hqptuner/core/lifecycle.py, and wait on its one wake event, changed",
        file=sys.stderr,
    )
    return 1


def main(argv: list[str]) -> int:
    """Refuse any retired lifecycle name or new manager event in the files handed over."""
    return report([problem for path in map(Path, argv) if path.is_file() for problem in check_file(path)])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
