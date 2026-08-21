#!/usr/bin/env python3
"""Gate: the committed OpenAPI snapshot matches the REST surface the app actually serves.

Nothing else pins that surface. A renamed route, a dropped response field or a
changed model passes every other gate — ruff, mypy and the suite all stay green,
because each of them is asking about the Python and none of them is asking what
the browser is handed. The break surfaces later, in the frontend, as a fetch
that returns the wrong shape.

So the surface is committed as a file. ``docs/openapi.json`` is the app's own
OpenAPI document, normalized to sorted-key JSON so a diff is readable, and this
gate rebuilds it and compares. A deliberate change to the API is one command and
one reviewable file in the diff; an accidental one is a red gate.

This is a gate rather than a test on purpose: ``docs/testing.md`` rule 5 keeps
golden-dump equality out of the suite. A snapshot that wants a human to look at
a diff is the wrong shape for a test and the right shape for a gate.

Two properties keep it deterministic. The audit router mounts only when the
audit log is enabled, so the gate builds the app with ``debug_log`` set and
pins those routes rather than leaving them to whatever the caller's environment
happens to say. And ``create_app`` tolerates absent hqplayerd credentials, so
the build needs no ``hqpcreds`` and opens no socket.

Usage: ``python scripts/gates/check_openapi.py`` — or ``--write`` to accept.
"""

from __future__ import annotations

import difflib
import json
import sys
from pathlib import Path
from typing import Any

from hqptuner.api.factory import create_app
from hqptuner.config import Config

ROOT = Path(__file__).resolve().parent.parent.parent

#: The committed surface this gate compares against.
SNAPSHOT = ROOT / "docs" / "openapi.json"

#: Printed on every failure. The fix is one command, whichever way the gate red.
ACCEPT = "run scripts/gates/check_openapi.py --write to accept this change"


def render(spec: dict[str, Any]) -> str:
    """Normalize an OpenAPI mapping to sorted-key, two-space JSON with a trailing newline."""
    return json.dumps(spec, indent=2, sort_keys=True) + "\n"


def current_spec() -> str:
    """Render the live app's OpenAPI document as stable JSON text.

    ``debug_log`` is set so the audit router is part of the pinned surface. The
    path is never opened: enabling the log creates no file.
    """
    app = create_app(Config(debug_log=Path("audit.jsonl")))
    return render(app.openapi())


def compare(committed: str, current: str) -> list[str]:
    """Unified-diff lines between the committed snapshot and the current surface; empty when equal."""
    return list(
        difflib.unified_diff(
            committed.splitlines(),
            current.splitlines(),
            fromfile="docs/openapi.json",
            tofile="current",
            lineterm="",
        )
    )


def check(snapshot: Path, current: str, *, write: bool = False) -> int:
    """Compare the surface against ``snapshot``, or regenerate it. 0 pass, 1 fail."""
    if write:
        snapshot.write_text(current)
        print(f"[ok] wrote {snapshot.name}, {len(current.splitlines())} lines")
        return 0
    if not snapshot.exists():
        print(f"{snapshot.name}: no committed snapshot")
        print(ACCEPT)
        return 1
    diff = compare(snapshot.read_text(), current)
    if diff:
        for line in diff:
            print(line)
        print(ACCEPT)
        return 1
    print(f"[ok] {snapshot.name} matches the served REST surface")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Check this repo's snapshot, or rewrite it when handed ``--write``."""
    args = sys.argv[1:] if argv is None else argv
    return check(SNAPSHOT, current_spec(), write="--write" in args)


if __name__ == "__main__":
    raise SystemExit(main())
