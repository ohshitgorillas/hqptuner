#!/usr/bin/env python3
"""PostToolUse hook: run the changelog style gate on a write to CHANGELOG.md.

The gate itself is ``scripts/gates/check_changelog.py``, which runs in the
Makefile and in pre-commit. Both of those are minutes-to-hours after the entry
was written, by which point the agent that wrote it has moved on and the fix
costs a round of review. This runs it at the moment of the write, so the agent
reads the complaint inside the loop that produced it and corrects itself.

Blocks (exit 2) with the gate's own output; silent on any other file.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
GATE = ROOT / "scripts" / "gates" / "check_changelog.py"


def main() -> int:
    """Gate the file this hook payload names, if it is the changelog."""
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    target = (payload.get("tool_input") or {}).get("file_path")
    if not target or Path(target).name != "CHANGELOG.md":
        return 0

    python = ROOT / ".venv" / "bin" / "python"
    result = subprocess.run(
        [str(python if python.exists() else sys.executable), str(GATE), target],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return 0
    print(result.stdout.strip(), file=sys.stderr)
    print(
        "Changelog entries are for the person hitting the bug: a bold lead saying what "
        "it does now, then what went wrong, in one line and impersonally. See CONTRIBUTING.md.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
