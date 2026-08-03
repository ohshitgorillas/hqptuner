#!/usr/bin/env python3
"""PreToolUse hook: the version number is the user's, and no agent may set it.

Wired session-wide from `.claude/settings.json`, so it binds every agent —
orchestrator and subagents alike. Deliberately not a memory note or a line in
CLAUDE.md: both are advisory, and the agent that must not bump is the same agent
deciding whether this bump is the exception.

Revoked on 2026-08-03, after an agent chose `--minor` for a pure bug-fix release
(shipped 1.2.0, should have been a patch) and then, while retracting that, chose
`--patch` and re-shipped 1.1.1 — neither number asked for. A version is a product
decision; `scripts/bump.sh` only executes it.

Blocked:

  * a Bash command naming `bump.sh`, however it is spelled or reached
  * an Edit/Write that sets `__version__` in `hqptuner/__init__.py` or `version`
    in `pyproject.toml` — the hand-edit path around the script

Not blocked: `scripts/ship.sh` (promotion is its own decision, and it refuses
anything that is not already a release commit), and edits to `pyproject.toml`
that leave the version line alone.

The Bash rule matches the NAME, not the invocation, so a read-only command that
merely mentions the script — `cat scripts/bump.sh`, a grep whose pattern is the
filename — is refused too. That is deliberate. A reader exemption is a hole
shaped exactly like `sed -n … | bash`, and the Read tool opens the file anyway.
"""

from __future__ import annotations

import json
import os
import re
import sys

#: the bump script, by name, however the command reaches it
BASH_BUMP = re.compile(r"\bbump\.sh\b")
#: a version assignment in either version file
VERSION_LINE = re.compile(r"""(?:^|\s)(?:__version__|version)\s*=\s*["']\d""", re.MULTILINE)

VERSION_FILES = ("hqptuner/__init__.py", "pyproject.toml")

_WHY = (
    "Version bumps are the user's call, not an agent's. Do not run scripts/bump.sh and do "
    "not hand-edit the version files. When work is ready to ship, say so and ask which "
    "version — never infer one from how the user described the change, and never re-release "
    "a retracted version on your own."
)


def _touches_version_file(target: str, cwd: str) -> bool:
    resolved = os.path.abspath(os.path.join(cwd or ".", target or ""))
    return any(resolved.endswith(os.path.join(*name.split("/"))) for name in VERSION_FILES)


def _verdict(name: str, tool_input: dict, cwd: str) -> str | None:
    """Why this call is refused, or None to let it through."""
    if name == "Bash":
        return _WHY if BASH_BUMP.search(tool_input.get("command", "")) else None
    if name in ("Edit", "Write", "NotebookEdit"):
        if not _touches_version_file(tool_input.get("file_path", ""), cwd):
            return None
        payload = "\n".join(
            str(tool_input.get(key, "")) for key in ("new_string", "old_string", "content", "new_source")
        )
        return _WHY if VERSION_LINE.search(payload) else None
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return  # never block on our own failure
    cwd = data.get("cwd") or os.getcwd()
    reason = _verdict(data.get("tool_name", ""), data.get("tool_input") or {}, cwd)
    if reason is None:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


if __name__ == "__main__":
    main()
