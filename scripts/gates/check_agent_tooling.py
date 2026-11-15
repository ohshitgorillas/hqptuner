#!/usr/bin/env python3
"""Gate: the tracked agent settings allow exact commands and enable no MCP server.

``.claude/settings.json`` is read by every agent session in this checkout, so
what it allows runs without a prompt. An allow rule that runs ``pip install``
or ``npx`` fetches and executes code from a package index on that say-so, and
an ``enabledMcpjsonServers`` key switches on a server the owner's own local
settings are meant to choose.

Usage: ``python scripts/gates/check_agent_tooling.py [checkout-root]``
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: The settings file under a checkout root.
SETTINGS = ".claude/settings.json"

#: A command that fetches code from a package index and runs it.
FETCHES_CODE = re.compile(r"\b(?:pip3?\s+install|npx)\b")


def settings_failures(name: str, source: str) -> list[str]:
    """One line per fault in a settings file: a fetching allow rule, or an MCP self-enable.

    Raises ``ValueError`` when the file is not JSON.
    """
    data = json.loads(source)
    permissions = data.get("permissions") if isinstance(data, dict) else None
    allow = permissions.get("allow") if isinstance(permissions, dict) else None
    lines = [
        f"{name}: allow rule {rule!r} runs a package fetch"
        for rule in allow or []
        if isinstance(rule, str) and FETCHES_CODE.search(rule)
    ]
    if isinstance(data, dict) and "enabledMcpjsonServers" in data:
        lines.append(f"{name}: enabledMcpjsonServers enables an MCP server; the owner enables it in local settings")
    return lines


def main(argv: list[str]) -> int:
    """Check one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    path = root / SETTINGS
    lines = [f"{SETTINGS}: missing, so the allow rules cannot be checked"]
    if path.is_file():
        try:
            lines = settings_failures(SETTINGS, path.read_text(encoding="utf-8"))
        except ValueError:
            lines = [f"{SETTINGS}: not valid JSON, so nothing in it can be checked"]
    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Allow exact commands only and leave MCP servers to local settings.")
        return 1
    print("[ok] the tracked settings allow no package fetch and enable no MCP server")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
