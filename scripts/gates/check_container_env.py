#!/usr/bin/env python3
"""Gate: every ``Path`` field on ``Config`` is pinned into the image under ``/state``.

A ``Path`` field reads its own ``HQPTUNER_*`` variable and falls back to a
default computed from the package's own location. In the image that default
resolves under ``/app``, which the non-root runtime user cannot write, so a
field nobody pinned is a 500 the first time a route reaches disk. The whole
offline suite is blind to it: catching it needs a container, a write and a route
that gets there.

Presence alone is not the check. A Dockerfile pinning a field back into ``/app``
satisfies "an env var exists" and reintroduces the unwritable path, so the value
is checked too: it has to sit under ``/state``, the bind-mounted directory.

A field that is deliberately not pinned is spelled in ``EXEMPT``, suffix to the
reason. An exemption naming a suffix the config no longer has, or one naming a
suffix that is pinned after all, is drift and fails the same way a missing pin
does.

Usage: ``python scripts/gates/check_container_env.py [config.py Dockerfile]``
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: The bind-mounted directory a pinned path has to sit under.
STATE = "/state"

#: The two readers a ``Path`` field's ``default_factory`` calls, either of which
#: takes the env suffix as its first argument.
READERS = ("_env", "_optional_path")

#: Fields deliberately left unpinned, env suffix to the reason.
EXEMPT: dict[str, str] = {
    "DATA_DIR": "package data ships inside the wheel, read-only, never written",
    "DEBUG_LOG": "deliberately unset; the operator sets it on the container",
}


def _is_path_annotation(node: ast.expr | None) -> bool:
    """Whether an annotation is ``Path`` or ``Path | None``."""
    if isinstance(node, ast.Name):
        return node.id == "Path"
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _is_path_annotation(node.left) or _is_path_annotation(node.right)
    return False


def _suffix(node: ast.expr) -> str:
    """Return the env suffix handed to the first ``_env`` / ``_optional_path`` call under ``node``."""
    for child in ast.walk(node):
        if not isinstance(child, ast.Call) or not isinstance(child.func, ast.Name):
            continue
        if child.func.id not in READERS or not child.args:
            continue
        first = child.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return first.value
    return ""


def path_fields(config_source: str) -> dict[str, str]:
    """Field name to env suffix, for every ``Path``-annotated field on ``Config``."""
    fields: dict[str, str] = {}
    for node in ast.walk(ast.parse(config_source)):
        if not isinstance(node, ast.ClassDef) or node.name != "Config":
            continue
        for statement in node.body:
            if not isinstance(statement, ast.AnnAssign) or not isinstance(statement.target, ast.Name):
                continue
            if not _is_path_annotation(statement.annotation) or statement.value is None:
                continue
            suffix = _suffix(statement.value)
            if suffix:
                fields[statement.target.id] = suffix
    return fields


def pinned(dockerfile_source: str) -> dict[str, str]:
    """Env suffix to pinned value, over every live ``ENV`` line and its continuations."""
    pins: dict[str, str] = {}
    continuing = False
    for raw in dockerfile_source.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if continuing:
            assignment = line
        elif line.upper().startswith("ENV "):
            assignment = line[4:].strip()
        else:
            continue
        continuing = assignment.endswith("\\")
        assignment = assignment.rstrip("\\").strip()
        for pair in assignment.split():
            name, _, value = pair.partition("=")
            if value and name.startswith("HQPTUNER_"):
                pins[name[len("HQPTUNER_") :]] = value.strip("\"'")
    return pins


def failures(fields: dict[str, str], pins: dict[str, str], exempt: dict[str, str] | None = None) -> list[str]:
    """One line per field the image would leave writing into an unwritable default."""
    if exempt is None:
        exempt = EXEMPT
    lines: list[str] = []
    for name, suffix in sorted(fields.items()):
        value = pins.get(suffix)
        if value is None:
            if suffix not in exempt:
                lines.append(f"{name}: not pinned in the image; add ENV HQPTUNER_{suffix}={STATE}/<name>")
        elif not value.startswith(f"{STATE}/"):
            lines.append(f"{name}: HQPTUNER_{suffix} is pinned to {value}, which is outside {STATE}")
    suffixes = set(fields.values())
    for suffix in sorted(exempt):
        if suffix not in suffixes:
            lines.append(f"EXEMPT[{suffix!r}]: names no Path field on Config")
        elif suffix in pins:
            lines.append(f"EXEMPT[{suffix!r}]: the field is pinned, so the exemption is stale")
    return lines


def main(argv: list[str]) -> int:
    """Read the config and the Dockerfile, print what is unpinned, and say so in the exit status."""
    config_path, dockerfile_path = (
        (Path(argv[0]), Path(argv[1])) if argv else (ROOT / "hqptuner" / "config.py", ROOT / "Dockerfile")
    )
    fields = path_fields(config_path.read_text(encoding="utf-8"))
    pins = pinned(dockerfile_path.read_text(encoding="utf-8"))
    lines = failures(fields, pins)

    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Every Path field on Config is pinned under {STATE} in the")
        print("Dockerfile, or carries an EXEMPT entry saying why it is deliberately unpinned.")
        return 1
    print(f"[ok] all {len(fields)} Path fields on Config are pinned under {STATE} or exempt")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
