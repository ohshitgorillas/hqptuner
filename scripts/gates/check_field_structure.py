#!/usr/bin/env python3
"""Gate: refuse field-keyed tables and enumeration loops outside their approved homes.

The gate reads each Python file it is handed as a syntax tree and refuses two
shapes, one problem per hit, each line opening with ``<path>:<line>:``, exit 1
on any hit and 0 on none: a module-level mapping or set keyed by field names
(the names of the rows in ``hqptuner/fields/register.py``) except within
``hqptuner/fields/`` or in ``hqptuner/conf/xmledit.py``; and an iteration over an
Engine enumeration list (the lists a reading holds under ``enums``) in any file other than
``hqptuner/engine/view.py``.

Usage: ``python scripts/gates/check_field_structure.py $(git ls-files 'hqptuner/*.py')``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

from hqptuner.fields.register import FIELDS

#: Every field name, read off the register's rows.
FIELD_NAMES = frozenset(field.name for field in FIELDS)

#: The field register's package, as the path components a spared file's directory ends with.
FIELDS_PACKAGE = ("hqptuner", "fields")

#: The XML editor's wire-structure table home, spared only by the table rule.
XML_EDITOR = ("hqptuner", "conf", "xmledit.py")

#: The Engine view, as the path components it ends with.
ENGINE_VIEW = ("hqptuner", "engine", "view.py")

#: The name an Engine reading holds its enumeration lists under.
ENUMS = "enums"

#: The calls that build a set from the strings in their argument.
SET_CALLS = frozenset({"set", "frozenset"})

#: The syntax nodes that hold comprehension generators.
COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)

#: One shape the gate found: its line, then what it is.
Hit = tuple[int, str]


def ends_with(parts: tuple[str, ...], tail: tuple[str, ...]) -> bool:
    """Whether ``parts`` ends with the path components ``tail``."""
    return parts[-len(tail) :] == tail


def field_constant(node: ast.AST | None) -> str | None:
    """Return the field name ``node`` spells as a string constant, or None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in FIELD_NAMES:
        return node.value
    return None


def call_keys(node: ast.Call) -> list[str | None]:
    """Return the field names a ``dict(...)`` keyword or a ``set(...)``/``frozenset(...)`` argument spells."""
    name = node.func.id if isinstance(node.func, ast.Name) else ""
    if name == "dict":
        return [keyword.arg if keyword.arg in FIELD_NAMES else None for keyword in node.keywords]
    if name in SET_CALLS:
        return [field_constant(inner) for arg in node.args for inner in ast.walk(arg)]
    return []


def node_keys(node: ast.AST) -> list[str | None]:
    """Return the field names ``node`` uses as table keys, in a display or a builder call."""
    if isinstance(node, ast.Dict):
        return [field_constant(key) for key in node.keys]
    if isinstance(node, ast.Set):
        return [field_constant(element) for element in node.elts]
    if isinstance(node, ast.Call):
        return call_keys(node)
    return []


def table_key(value: ast.expr) -> str | None:
    """Return the first field name the assigned ``value`` keys a table by, or None."""
    keys = [key for node in ast.walk(value) for key in node_keys(node) if key]
    return keys[0] if keys else None


def table_hit(statement: ast.stmt) -> list[Hit]:
    """Report a module-level assignment whose value is a table keyed by field names."""
    if not isinstance(statement, (ast.Assign, ast.AnnAssign)) or statement.value is None:
        return []
    key = table_key(statement.value)
    if key is None:
        return []
    return [(statement.lineno, f"table keyed by field name {key!r}; read it off hqptuner.fields instead")]


def field_tables(tree: ast.Module) -> list[Hit]:
    """Every top-level statement that binds a table keyed by field names."""
    return [hit for statement in tree.body for hit in table_hit(statement)]


def reads_enums(node: ast.expr) -> bool:
    """Whether the expression ``node`` reads ``enums``, as an attribute or a name."""
    return any(
        (isinstance(inner, ast.Attribute) and inner.attr == ENUMS)
        or (isinstance(inner, ast.Name) and inner.id == ENUMS)
        for inner in ast.walk(node)
    )


def loop_iterables(node: ast.AST) -> list[ast.expr]:
    """Return the iterables a loop statement or a comprehension walks; none for any other node."""
    if isinstance(node, (ast.For, ast.AsyncFor)):
        return [node.iter]
    if isinstance(node, COMPREHENSIONS):
        return [generator.iter for generator in node.generators]
    return []


def enumeration_loops(tree: ast.Module) -> list[Hit]:
    """Every loop or comprehension whose iterable reads an Engine enumeration list."""
    return [
        (getattr(node, "lineno", 0), "loop over an Engine enumeration list; ask hqptuner.engine.view instead")
        for node in ast.walk(tree)
        if any(reads_enums(iterable) for iterable in loop_iterables(node))
    ]


def check_file(path: Path) -> list[str]:
    """Every refused shape in one file, in line order."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    tables = (
        [] if ends_with(path.parent.parts, FIELDS_PACKAGE) or ends_with(path.parts, XML_EDITOR) else field_tables(tree)
    )
    loops = [] if ends_with(path.parts, ENGINE_VIEW) else enumeration_loops(tree)
    return [f"{path}:{line}: {what}" for line, what in sorted(tables + loops)]


def main(argv: list[str]) -> int:
    """Refuse any field-keyed table or enumeration loop in the files handed over."""
    problems = [problem for path in map(Path, argv) if path.is_file() for problem in check_file(path)]
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
