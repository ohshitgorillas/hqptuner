"""Reading the audit log back, independently of the module that writes it.

Both audit wiring suites read the JSONL file with a plain ``json.loads`` per
line rather than through the audit module's own reader: a log nothing but its
own reader can parse is not a forensic record. These two helpers are that read,
shared rather than copied per file.
"""

import json
from pathlib import Path
from typing import Any


def records(path: Path) -> list[dict[str, Any]]:
    """Every record in the log, oldest first — an empty list for a log nothing
    has written to yet."""
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def last(path: Path, event: str) -> dict[str, Any]:
    """The most recent record of that event, or an empty one if it never came."""
    matching = [record for record in records(path) if record.get("event") == event]
    return matching[-1] if matching else {}
