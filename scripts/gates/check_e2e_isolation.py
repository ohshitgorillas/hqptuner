#!/usr/bin/env python3
"""Gate: the browser e2e stack redirects every filesystem path the app writes.

The e2e app is a real subprocess reading its whole configuration from
``HQPTUNER_*`` environment variables, and the harness sets those in one place
(``tests/e2e/support/stack.py``, ``_app_env``). Any path knob it does not set
falls back to the default in ``hqptuner/config.py``, which points inside the
repo — so the app boots on the developer's own saved state and writes back into
the checkout.

That is not cosmetic. The narrowing facets filter the filter enumerations, so a
single saved facet empties a chain selector and the browser reads it as the
engine offering nothing: the suite goes red on a machine whose only sin was
using the app. It has now happened twice, once per state file added, and each
time the harness looked correct because the knob it forgot was new.

So the rule is mechanical: every ``Path``-typed field on ``Config`` is either
redirected in ``_app_env`` or carries a line of prose here saying why it is not.
An exemption naming no field fails too — a stale reason is the same drift one
layer up.

Usage: ``python scripts/gates/check_e2e_isolation.py``
"""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

CONFIG = ROOT / "hqptuner" / "config.py"
STACK = ROOT / "tests" / "e2e" / "support" / "stack.py"

#: Path fields the stack deliberately leaves at their default, name to reason.
#: Read-only inputs only: a field the app WRITES can never be exempt, because the
#: write lands in the checkout.
EXEMPT: dict[str, str] = {
    "data_dir": "shipped read-only metadata, never written; the tests want the real tables",
}


def settings_path_fields() -> list[str]:
    """Every ``Path``-typed field name on ``Config``, sorted.

    Read out of the source rather than off an imported dataclass: a gate that
    imports the app is a gate that can go red for reasons of its own.
    """
    tree = ast.parse(CONFIG.read_text())
    body = next(node.body for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == "Config")
    return sorted(
        node.target.id
        for node in body
        if isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and isinstance(node.annotation, ast.Name)
        and node.annotation.id == "Path"
    )


def env_name(field: str) -> str:
    """Build the environment variable a field is read from — the convention config.py follows."""
    return f"HQPTUNER_{field.upper()}"


def unredirected(fields: list[str], harness: str) -> list[str]:
    """Fields whose environment variable is set nowhere in the harness."""
    return [name for name in fields if name not in EXEMPT and env_name(name) not in harness]


def stale(fields: list[str]) -> list[str]:
    """Exemptions naming a field that no longer exists."""
    return sorted(set(EXEMPT) - set(fields))


def main() -> int:
    """Report every unredirected path knob and every exemption that names nothing."""
    fields = settings_path_fields()
    harness = STACK.read_text()
    missing = unredirected(fields, harness)
    gone = stale(fields)
    for name in missing:
        print(f"{STACK.relative_to(ROOT)}: _app_env does not set {env_name(name)} — the e2e app writes into the repo")
    for name in gone:
        print(f"{Path(__file__).name}: EXEMPT names {name!r}, which is not a Config field")
    return 1 if missing or gone else 0


if __name__ == "__main__":
    raise SystemExit(main())
