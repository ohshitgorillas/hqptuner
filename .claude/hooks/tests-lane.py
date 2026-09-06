#!/usr/bin/env python3
"""PreToolUse hook: `tests/` is the test-writer's lane, and only in its spec tree.

Wired session-wide from `.claude/settings.json`, so it binds the orchestrator
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/test-writer.md`, where the same script confines that agent to
its own tree's `tests/`.

The rule it enforces is the one `/tests` runs on: tests are written blind,
from an approved spec block, by the `test-writer`, in the `*-spec` worktree
`scripts/pair.sh open` cuts. Every other hand on a test file is the one the
chain exists to keep off it: the agent that implements the change editing a
test until it passes. `pair.sh merge` already refuses a lane crossing at merge
time; this hook refuses it at the write.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under `tests/` of any
    checkout, unless the caller's `agent_type` is `test-writer` AND the
    target is inside a `.claude/worktrees/*-spec` tree
  * for the `test-writer`, any `Write`/`Edit` outside its spec tree's `tests/`
  * a `Bash` command that `free_bash` meters and that names a `tests/` path,
    except a restore from a named git object (`git restore --source <rev>`
    or `git checkout <rev> --` onto the path), which copies a commit and
    types nothing

Allowed: every read-only command naming `tests/` (`pytest`, `cat`, `sed -n`,
`grep`), and every write elsewhere.

`agent_type` is present in the payload only for subagent calls; an absent key
is the orchestrator. If a build omits the key for subagents too, the writer is
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

WRITER = "test-writer"
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
#: a `tests/` path token anywhere in a shell command, relative or absolute
BASH_TESTS = re.compile(r"(?:^|[\s\"'=(:])(?:[^\s\"']*/)?tests/")

_LANE = (
    "tests/ is the test-writer's lane, written only in its spec tree from the "
    "committed spec block. A test that must change goes back through the spec: "
    "a re-approved line, a new `spec:` commit, a delta to the writer. Never by "
    "hand, never in the impl tree, never on dev. (.claude/hooks/tests-lane.py)"
)
_WRITER_LANE = (
    "Blind writer: you write under tests/ of your own spec tree and nowhere else. "
    "Not hqptuner/, not docs/, not another worktree. (.claude/hooks/tests-lane.py)"
)
_BASH = (
    "A shell write naming a tests/ path is denied: " + _LANE + " Restoring a test "
    "from a git object is the one shell shape that passes: "
    "`git restore --source <rev> -- tests/<file>`."
)


def _load(name: str):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _checkout_root(path: str) -> str | None:
    """The checkout (main or worktree) containing `path`, by walking up to a `.git`."""
    while True:
        if os.path.exists(os.path.join(path, ".git")):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def _root_by_name(path: str) -> str | None:
    """A checkout root read off the path alone, for trees that need not exist.

    `.claude/worktrees/<slug>-spec` and `-impl` are roots by construction; the
    directory holding `.claude/worktrees` is the main checkout.
    """
    parts = path.split(os.sep)
    for i in range(len(parts) - 1, 1, -1):
        if parts[i - 2] == ".claude" and parts[i - 1] == "worktrees":
            return os.sep.join(parts[: i + 1])
    return None


def _split_root(target: str, cwd: str) -> tuple[str | None, str | None]:
    """(checkout root, path relative to it) for a write target, or (None, None)."""
    resolved = os.path.abspath(os.path.join(cwd, target))
    root = _root_by_name(resolved) or _checkout_root(os.path.dirname(resolved))
    if root is None:
        return None, None
    return root, os.path.relpath(resolved, root)


def _is_spec_tree(root: str) -> bool:
    parent, name = os.path.split(root)
    return name.endswith("-spec") and os.path.basename(parent) == "worktrees"


def _under_tests(rel: str) -> bool:
    return rel == "tests" or rel.startswith("tests" + os.sep)


def _write_verdict(target: str, cwd: str, agent: str) -> str | None:
    root, rel = _split_root(target, cwd)
    if root is None or rel is None or rel.startswith(".."):
        return _WRITER_LANE if agent == WRITER else None
    in_tests = _under_tests(rel)
    if agent == WRITER:
        return None if in_tests and _is_spec_tree(root) else _WRITER_LANE
    return _LANE if in_tests else None


def _is_object_restore(words: list[str]) -> bool:
    """`git restore --source <rev> -- <paths>` or `git checkout <rev> -- <paths>`."""
    if len(words) < 4 or words[0] != "git":
        return False
    if words[1] == "restore":
        return "--source" in words[2:] or any(w.startswith("--source=") for w in words[2:])
    if words[1] == "checkout":
        return "--" in words[2:] and not words[2].startswith("-")
    return False


#: git subcommands that never write the working tree; a commit message or a
#: pathspec naming tests/ is not a write to it
GIT_NO_WORKTREE = {"commit", "add", "log", "show", "diff", "status", "blame"}


_SEGMENT = re.compile(r"\s*(?:&&|\|\||;|\|)\s*")
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")


def _strip_heredocs(command: str) -> str:
    """Drop heredoc bodies: a commit message that mentions tests/ is prose, not a path."""
    lines = command.split("\n")
    out: list[str] = []
    terminator: str | None = None
    for line in lines:
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        out.append(line)
        m = _HEREDOC.search(line)
        if m:
            terminator = m.group(2)
    return "\n".join(out)


def _segment_ok(segment: str, free) -> bool:
    """One pipeline stage: free, a git command that never writes the tree, or an object restore."""
    if not BASH_TESTS.search(segment) or free.is_free_bash(segment):
        return True
    try:
        words = shlex.split(segment, comments=False, posix=True)
    except ValueError:
        words = segment.split()
    if len(words) > 1 and words[0] == "git" and words[1] in GIT_NO_WORKTREE:
        return True
    return _is_object_restore(words)


def _bash_verdict(command: str, free) -> str | None:
    if not BASH_TESTS.search(command) or free.is_free_bash(command):
        return None
    command = _strip_heredocs(command)
    segments = [s for s in _SEGMENT.split(command) if s]
    return None if all(_segment_ok(s, free) for s in segments) else _BASH


def _verdict(name: str, tool_input: dict, payload: dict, free=None) -> str | None:
    """Why this call is refused, or None to let it through."""
    cwd = payload.get("cwd") or os.getcwd()
    agent = payload.get("agent_type") or ""
    if name in WRITE_TOOLS:
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _write_verdict(target, cwd, agent) if target else None
    if name == "Bash":
        return _bash_verdict(tool_input.get("command", ""), free or _load("free_bash"))
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return  # never block on our own failure
    reason = _verdict(data.get("tool_name", ""), data.get("tool_input") or {}, data)
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


def self_test() -> int:
    """Pin the three spec lines of specs/writer-only-tests.txt."""
    root = _checkout_root(os.path.dirname(os.path.abspath(__file__))) or "/repo"
    spec = os.path.join(root, ".claude", "worktrees", "x-spec")
    impl = os.path.join(root, ".claude", "worktrees", "x-impl")
    free = _load("free_bash")

    def write(path: str, agent: str | None = None) -> str | None:
        payload = {"cwd": root}
        if agent:
            payload["agent_type"] = agent
        return _verdict("Edit", {"file_path": path}, payload, free)

    def bash(cmd: str) -> str | None:
        return _verdict("Bash", {"command": cmd}, {"cwd": root}, free)

    denied, allowed = (lambda v: isinstance(v, str)), (lambda v: v is None)
    lines = {
        "1 tests/ closed to all but the writer in a spec tree": all(
            (
                denied(write(f"{root}/tests/t.py")),
                denied(write(f"{impl}/tests/t.py")),
                denied(write(f"{spec}/tests/t.py")),
                denied(write(f"{impl}/tests/t.py", "caveman:cavecrew-builder")),
                allowed(write(f"{spec}/tests/t.py", WRITER)),
                denied(write(f"{impl}/tests/t.py", WRITER)),
            )
        ),
        "2 writer confined to its spec tree's tests/": all(
            (
                denied(write(f"{spec}/hqptuner/core/m.py", WRITER)),
                denied(write(f"{spec}/docs/testing.md", WRITER)),
                allowed(write(f"{spec}/tests/conftest.py", WRITER)),
            )
        ),
        "3 shell writes naming tests/ denied, reads and object restores pass": all(
            (
                denied(bash("sed -i 's/a/b/' tests/t.py")),
                allowed(bash(".venv/bin/pytest tests/t.py -q")),
                allowed(bash("cat tests/t.py")),
                allowed(bash("git restore --source abc1234 -- tests/t.py")),
                allowed(bash("git checkout abc1234 -- tests/t.py")),
                denied(bash("echo x > tests/t.py")),
            )
        ),
    }
    for label, ok in lines.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(lines.values()) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
