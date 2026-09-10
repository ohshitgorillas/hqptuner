#!/usr/bin/env python3
"""Shell and path shapes the lane hooks share.

The lane hooks all ask the same two questions: does this path fall inside a
directory that belongs to one agent, and does this shell command write
anything. This module answers both, so that a hook is a policy over the
answers rather than a second parser.

It is deliberately standalone. These hooks travel as a unit into other repos,
where the change budget and its `free_bash` allowlist do not exist, so the
read-only judgment here is a small closed allowlist of its own: a command is a
read unless its first word is a known reader, and a redirection makes any
command a write whatever its first word is. Unknown command, unknown effect,
treated as a write. That is the safe direction for a lane: an over-denied
read costs a message, an under-denied write costs the lane.
"""

from __future__ import annotations

import os
import re
import shlex

#: first words of commands that only read; anything else is treated as a write
READ_ONLY = frozenset(
    {
        "awk", "basename", "cat", "cksum", "column", "comm", "cut", "diff",
        "dirname", "du", "echo", "false", "fgrep", "file", "find", "grep",
        "head", "jq", "less", "ls", "md5sum", "nl", "node", "npx", "od",
        "printf", "pytest", "pwd", "realpath", "rg", "sha256sum", "sort",
        "stat", "tail", "test", "tr", "true", "uniq", "wc", "which", "xxd",
        "yq",
    }
)

#: git subcommands that never write the working tree; a commit message or a
#: pathspec naming a lane is not a write to it
GIT_NO_WORKTREE = frozenset(
    {"add", "blame", "commit", "diff", "log", "ls-files", "rev-parse", "show", "status"}
)

#: an output redirection; `2>&1` and `>&2` are not one
REDIRECT = re.compile(r"(?:^|[^0-9<>&])>>?(?![&>])")

_SEGMENT = re.compile(r"\s*(?:&&|\|\||;|\|)\s*")
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")


def strip_heredocs(command: str) -> str:
    """Drop heredoc bodies, so prose that mentions a lane is not read as a path.

    The redirection that opens the heredoc stays on its own line, so
    `cat > lane/x.txt <<EOF` is still seen as the write it is.
    """
    out: list[str] = []
    terminator: str | None = None
    for line in command.split("\n"):
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        out.append(line)
        m = _HEREDOC.search(line)
        if m:
            terminator = m.group(2)
    return "\n".join(out)


def segments(command: str) -> list[str]:
    """The pipeline stages of a command, heredoc bodies removed."""
    return [s for s in _SEGMENT.split(strip_heredocs(command)) if s]


def is_object_restore(words: list[str]) -> bool:
    """`git restore --source <rev> -- <paths>` or `git checkout <rev> -- <paths>`.

    Both copy a named commit onto a path. Neither types content, so a lane that
    has git history can be reverted without going around its writer.
    """
    if len(words) < 4 or words[0] != "git":
        return False
    if words[1] == "restore":
        return "--source" in words[2:] or any(w.startswith("--source=") for w in words[2:])
    if words[1] == "checkout":
        return "--" in words[2:] and not words[2].startswith("-")
    return False


def words_of(segment: str) -> list[str]:
    try:
        return shlex.split(segment, comments=False, posix=True)
    except ValueError:
        return segment.split()


def segment_writes(segment: str, *, restore_ok: bool = True) -> bool:
    """Does this one pipeline stage change anything on disk?"""
    if REDIRECT.search(segment):
        return True
    words = words_of(segment)
    if not words:
        return False
    head = os.path.basename(words[0])
    if head == "git":
        if len(words) > 1 and words[1] in GIT_NO_WORKTREE:
            return False
        return not (restore_ok and is_object_restore(words))
    if head == "sed":
        return any(w == "-i" or w.startswith("-i") for w in words[1:])
    return head not in READ_ONLY


def command_writes(command: str, *, restore_ok: bool = True) -> bool:
    """Does any stage of this command change anything on disk?"""
    return any(segment_writes(s, restore_ok=restore_ok) for s in segments(command))


def lane_pattern(lane: str) -> re.Pattern[str]:
    """A regex matching a `<lane>/` path token in a shell command, relative or absolute."""
    return re.compile(r"(?:^|[\s\"'=(:])(?:[^\s\"']*/)?" + re.escape(lane) + "/")


def bash_touches_lane(command: str, pattern: re.Pattern[str]) -> bool:
    return bool(pattern.search(command))


def lane_write_in(command: str, pattern: re.Pattern[str], *, restore_ok: bool = True) -> bool:
    """Does any stage that names the lane write to it?"""
    if not pattern.search(command):
        return False
    return any(
        pattern.search(s) and segment_writes(s, restore_ok=restore_ok) for s in segments(command)
    )


def checkout_root(path: str) -> str | None:
    """The checkout (main or worktree) containing `path`, by walking up to a `.git`."""
    while True:
        if os.path.exists(os.path.join(path, ".git")):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def root_by_name(path: str) -> str | None:
    """A checkout root read off the path alone, for trees that need not exist.

    `.claude/worktrees/<slug>-spec` and `-impl` are roots by construction; the
    directory holding `.claude/worktrees` is the main checkout.
    """
    parts = path.split(os.sep)
    for i in range(len(parts) - 1, 1, -1):
        if parts[i - 2] == ".claude" and parts[i - 1] == "worktrees":
            return os.sep.join(parts[: i + 1])
    return None


def split_root(target: str, cwd: str) -> tuple[str | None, str | None]:
    """(checkout root, path relative to it) for a write target, or (None, None)."""
    resolved = os.path.abspath(os.path.join(cwd, target))
    root = root_by_name(resolved) or checkout_root(os.path.dirname(resolved))
    if root is None:
        return None, None
    return root, os.path.relpath(resolved, root)


def under(rel: str, lane: str) -> bool:
    """Is this repo-relative path the lane directory or inside it?"""
    prefix = lane.replace("/", os.sep)
    return rel == prefix or rel.startswith(prefix + os.sep)


def path_in_lane(target: str, cwd: str, lane: str) -> bool:
    """Does the resolved target land inside a `<lane>` directory of any checkout?

    Falls back to a segment match when the path is in no checkout at all, so
    the lane holds before `git init` and outside a repo.
    """
    _, rel = split_root(target, cwd)
    if rel is not None and not rel.startswith(".."):
        return under(rel, lane)
    parts = os.path.abspath(os.path.join(cwd, target)).split(os.sep)
    lane_parts = lane.split("/")
    return any(
        parts[i : i + len(lane_parts)] == lane_parts
        for i in range(len(parts) - len(lane_parts))
    )


def deny(reason: str) -> str:
    """The PreToolUse deny payload, as a JSON string."""
    import json

    return json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
    )
