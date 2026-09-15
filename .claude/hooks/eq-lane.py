#!/usr/bin/env python3
"""PreToolUse hook: the EQ session's lane, an allowlist over `Bash`, `Write` and `Edit`.

Wired from `~/.claude/eq-settings.json`, which `bin/eq` passes to `--settings`,
and from nowhere else: `.claude/settings.json` does not register it, so a dev
session never sees it.

That session runs with `--setting-sources user`, which drops the project
settings source and every hook in it. This file is the only fence left, and
what it fences is the apply gate: the EQ assistant stages, and the user
applies (`docs/eq-assistant/STAGING.md`).

An allowlist rather than a denylist, because a denylist over URL strings does
not hold. The hook sees a shell command, and the session can write files:
`node /tmp/j.js` with the apply POST inside the file, or a URL assembled from
shell variables, names neither the route nor the port. So `Bash` permits the
two staging tools and a read-only set, and refuses everything else.

Writes are allowlisted for the same reason one hop back: an allowlist keyed on
script paths is worth nothing if the session can edit those scripts. Only
`docs/eq-assistant/sessions/` is writable, which is where the ledger and its
job files live (`docs/eq-assistant/RECORD.md`).

Path resolution, pipeline splitting and heredoc stripping are borrowed from
`shell_shapes.py` rather than restated.
"""

from __future__ import annotations

import json
import os
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

#: the two tools the session runs, as repo-relative paths
NODE_TOOLS = ("scripts/eqstage/eqstage.js", "scripts/eqlab/eqlab.js")
#: commands that read and change nothing, whatever their arguments
READ_ONLY = frozenset({"cat", "head", "tail", "grep", "ls", "wc", "jq"})
#: `git` subcommands that never write the working tree
GIT_READ_ONLY = frozenset({"status", "log", "diff", "show"})
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
#: the one writable subtree, repo-relative
WRITABLE = os.path.join("docs", "eq-assistant", "sessions")

_BASH = (
    "Denied: the EQ session's shell is an allowlist. Permitted: "
    "node scripts/eqstage/eqstage.js, node scripts/eqlab/eqlab.js, and "
    "read-only cat, head, tail, grep, ls, wc, jq, sed -n, git status|log|diff|show. "
    "Design and measure with eqlab, stage with eqstage; Apply is the user's "
    "click. (.claude/hooks/eq-lane.py)"
)
_WRITE = (
    "Denied: the EQ session writes docs/eq-assistant/sessions/ and nothing "
    "else. The ledger and its job files live there; the doctrine, the tools "
    "and the rest of the tree are read-only to this session. "
    "(.claude/hooks/eq-lane.py)"
)


def _is_node_tool(arg: str, cwd: str) -> bool:
    """Is this argument one of the two staging tools, in some checkout?"""
    _root, rel = sh.split_root(arg, cwd)
    if rel is None or rel.startswith(".."):
        return False
    return rel.replace(os.sep, "/") in NODE_TOOLS


def _words(segment: str) -> list[str] | None:
    """One pipeline stage as words, input redirection dropped, or None to refuse."""
    try:
        words = shlex.split(segment, comments=False, posix=True)
    except ValueError:
        return None
    if ">" in words or ">>" in words:
        return None
    if "<" in words:
        words = words[: words.index("<")]
    return words or None


def _segment_ok(segment: str, cwd: str) -> bool:
    words = _words(segment)
    if words is None:
        return False
    head = os.path.basename(words[0])
    if head == "node":
        return len(words) == 2 and _is_node_tool(words[1], cwd)
    if head == "sed":
        return len(words) > 1 and words[1] == "-n"
    if head == "git":
        return len(words) > 1 and words[1] in GIT_READ_ONLY
    return head in READ_ONLY


def _bash_verdict(command: str, cwd: str) -> str | None:
    segments = sh.segments(command)
    if not segments:
        return _BASH
    return None if all(_segment_ok(s, cwd) for s in segments) else _BASH


def _write_verdict(target: str, cwd: str) -> str | None:
    _root, rel = sh.split_root(target, cwd)
    if rel is None or rel.startswith(".."):
        return _WRITE
    if rel == WRITABLE or rel.startswith(WRITABLE + os.sep):
        return None
    return _WRITE


def verdict(name: str, tool_input: dict, payload: dict) -> str | None:
    """Why this call is refused, or None to let it through."""
    cwd = payload.get("cwd") or os.getcwd()
    if name in WRITE_TOOLS:
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _write_verdict(target, cwd) if target else None
    if name == "Bash":
        return _bash_verdict(tool_input.get("command", ""), cwd)
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return  # never block on our own failure
    reason = verdict(data.get("tool_name", ""), data.get("tool_input") or {}, data)
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
