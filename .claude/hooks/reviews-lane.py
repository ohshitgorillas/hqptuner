#!/usr/bin/env python3
"""PreToolUse hook: `docs/gauntlet/reviews/` is the reviewers' lane, and their only one.

Wired session-wide from `.claude/settings.json`, so it binds the orchestrator
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-arbiter.md` and `gauntlet-prosecutor.md`, where the
same script confines those two agents to that one directory.

The rule it enforces: a reviewer's verdict reaches `scripts/pair.sh open`
from a file the reviewer wrote itself, `docs/gauntlet/reviews/<slug>.<N>.txt`,
never from a transcription the orchestrator typed. So the two reviewers may
write there and nowhere else, and nobody else may write there at all. Reviewers
write relative to the main checkout, which is where `pair.sh open` looks.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under
    `docs/gauntlet/reviews/` of any checkout, unless the caller's `agent_type`
    is `gauntlet-arbiter` or `gauntlet-prosecutor`
  * for those two agents, any `Write`/`Edit`/`NotebookEdit` outside
    `docs/gauntlet/reviews/`, the gauntlet-arbiter's own
    `docs/gauntlet/specs/approved/` lane excepted, and any `Bash` command that
    `free_bash` meters
  * for those two agents, a `Read` or a `Grep` aimed under
    `docs/gauntlet/reviews/`, and a read-only `Bash` command naming such a path
  * for everyone else, a `Bash` command that `free_bash` meters and that
    names a `docs/gauntlet/reviews/` path

A reviewer is denied the lane's contents as well as its writes, because a
rejection burns the agent that printed it and its replacement continues the
numbering in the same directory: the `Glob` that finds the next `<N>` is
allowed and returns filenames, and a prior round reaches a reviewer only as
the carried verdicts in the author's own return.

Allowed: every read-only command naming `docs/gauntlet/reviews/` (`cat`,
`grep`, `sed -n`) for everyone but those two agents, git commands that never
write the working tree, `Glob` for anyone, and every write elsewhere by every
non-reviewer. The lane is gitignored, so there is no git object to restore
from and no restore carve-out.

`agent_type` is present in the payload only for subagent calls; an absent key
is the orchestrator. If a build omits the key for subagents too, a reviewer is
over-denied, which is the safe direction: nothing leaks, and the denial names
this file.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import sys

REVIEWERS = frozenset({"gauntlet-arbiter", "gauntlet-prosecutor"})
#: the one reviewer with a second lane, and the folder that lane is
APPROVED_WRITER = "gauntlet-arbiter"
APPROVED_LANE = os.path.join("docs", "gauntlet", "specs", "approved")
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
#: tools that hand back a file's contents; `Glob` returns names only and is not one
READ_TOOLS = ("Read", "Grep")
#: a `docs/gauntlet/reviews/` path token anywhere in a shell command, relative or absolute
BASH_REVIEWS = re.compile(r"(?:^|[\s\"'=(:])(?:[^\s\"']*/)?docs/gauntlet/reviews/")

_LANE = (
    "docs/gauntlet/reviews/ is the reviewers' lane: a verdict file is written "
    "by the gauntlet-arbiter or gauntlet-prosecutor that produced it, and "
    "scripts/pair.sh open compares the spec file against it. Nothing else "
    "writes there. (.claude/hooks/reviews-lane.py)"
)
_REVIEWER_LANE = (
    "Reviewer: your one write is your verdict, to "
    "docs/gauntlet/reviews/<slug>.<N>.txt of the main checkout, and for the "
    "gauntlet-arbiter the approved spec, to docs/gauntlet/specs/approved/. Not "
    "hqptuner/, not tests/, not the rest of docs/. "
    "(.claude/hooks/reviews-lane.py)"
)
_REVIEWER_BASH = (
    "Reviewer: a shell command that changes anything is denied; your one write "
    "is the Write tool onto docs/gauntlet/reviews/. Read-only shell (cat, grep, "
    "sed -n, make check, pytest) passes. (.claude/hooks/reviews-lane.py)"
)
_REVIEWER_READ = (
    "Reviewer: docs/gauntlet/reviews/ is not yours to read. A prior round "
    "reaches you as the carried verdicts in the author's return, never as a "
    "file: the round that rejected a brief printed the steering back verbatim, "
    "and it is written nowhere for you to find. Glob for the next <N> is "
    "allowed and returns filenames. (.claude/hooks/reviews-lane.py)"
)
_BASH = (
    "A shell write naming a docs/gauntlet/reviews/ path is denied: " + _LANE
)


def _load(name: str):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _under_reviews(rel: str) -> bool:
    prefix = os.path.join("state", "reviews")
    return rel == prefix or rel.startswith(prefix + os.sep)


def _in_reviews(target: str, cwd: str, lane) -> bool:
    """Does this path, or this glob, land inside some checkout's `state/reviews/`?"""
    root, rel = lane._split_root(target, cwd)
    return root is not None and rel is not None and not rel.startswith("..") and _under_reviews(rel)


def _in_approved(target: str, cwd: str, lane) -> bool:
    """Does this path land inside some checkout's `specs/approved/`?"""
    root, rel = lane._split_root(target, cwd)
    if root is None or rel is None or rel.startswith(".."):
        return False
    return rel == APPROVED_LANE or rel.startswith(APPROVED_LANE + os.sep)


def _write_verdict(target: str, cwd: str, agent: str, lane) -> str | None:
    in_reviews = _in_reviews(target, cwd, lane)
    if agent in REVIEWERS:
        if in_reviews:
            return None
        if agent == APPROVED_WRITER and _in_approved(target, cwd, lane):
            return None
        return _REVIEWER_LANE
    return _LANE if in_reviews else None


def _read_verdict(tool_input: dict, cwd: str, agent: str, lane) -> str | None:
    """A reviewer reads no round file; `Read` names one, `Grep` names a set."""
    if agent not in REVIEWERS:
        return None
    targets = (tool_input.get("file_path"), tool_input.get("path"), tool_input.get("glob"))
    aimed = any(t and _in_reviews(t, cwd, lane) for t in targets)
    return _REVIEWER_READ if aimed else None


def _segment_ok(segment: str, free, lane) -> bool:
    """One pipeline stage: free, or a git command that never writes the tree."""
    if not BASH_REVIEWS.search(segment) or free.is_free_bash(segment):
        return True
    try:
        words = shlex.split(segment, comments=False, posix=True)
    except ValueError:
        words = segment.split()
    return len(words) > 1 and words[0] == "git" and words[1] in lane.GIT_NO_WORKTREE


def _bash_verdict(command: str, agent: str, free, lane) -> str | None:
    if agent in REVIEWERS:
        if not free.is_free_bash(command):
            return _REVIEWER_BASH
        return _REVIEWER_READ if BASH_REVIEWS.search(command) else None
    if not BASH_REVIEWS.search(command) or free.is_free_bash(command):
        return None
    command = lane._strip_heredocs(command)
    segments = [s for s in lane._SEGMENT.split(command) if s]
    return None if all(_segment_ok(s, free, lane) for s in segments) else _BASH


def verdict(name: str, tool_input: dict, payload: dict, free=None, lane=None) -> str | None:
    """Why this call is refused, or None to let it through."""
    cwd = payload.get("cwd") or os.getcwd()
    agent = payload.get("agent_type") or ""
    lane = lane or _load("tests-lane")
    if name in WRITE_TOOLS:
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _write_verdict(target, cwd, agent, lane) if target else None
    if name in READ_TOOLS:
        return _read_verdict(tool_input, cwd, agent, lane)
    if name == "Bash":
        return _bash_verdict(tool_input.get("command", ""), agent, free or _load("free_bash"), lane)
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
