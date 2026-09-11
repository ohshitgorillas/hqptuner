#!/usr/bin/env python3
"""PreToolUse hook: `docs/gauntlet/specs/approved/` is the gauntlet-arbiter's lane.

Wire it session-wide from `.claude/settings.json`, so it binds the main agent
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-arbiter.md`, `.claude/agents/gauntlet-testsmith.md`,
`.claude/agents/gauntlet-accountant.md` and
`.claude/agents/gauntlet-detective.md`.

The lane ends at `approved`, so `docs/gauntlet/specs/drafts/` sits outside it
and needs no carve-out: a draft is written by any hand, and only the reviewed
block is the reviewer's alone.

An approved spec is the only thing the blind `gauntlet-testsmith` works from. If the
agent that wants a test can also write the file the test is generated from,
approval is a formality: the main agent states the behavior, hands it to the
writer, and the adversarial review it was supposed to survive never happened.
So the file is written by exactly one hand, the one that holds the gate.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under a
    `docs/gauntlet/specs/approved/` directory, unless the caller's
    `agent_type` is `gauntlet-arbiter`
  * a `Bash` command that names a `docs/gauntlet/specs/approved/` path and is
    not read-only, except a restore from a named git object
    (`git restore --source <rev>` or `git checkout <rev> --` onto the path),
    which copies a commit and types nothing

Allowed: every read of `docs/gauntlet/specs/approved/`, by any agent and by
the shell; every write anywhere else, including a draft spec under
`docs/gauntlet/specs/drafts/`.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent, which is denied. If a build omits the key for subagents
too, the gauntlet-arbiter is over-denied, which is the safe direction: no
unreviewed spec reaches the writer, and the denial names this file.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

REVIEWER = "gauntlet-arbiter"
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
LANE = "docs/gauntlet/specs/approved"
BASH_APPROVED = sh.lane_pattern(LANE)

_LANE = (
    "docs/gauntlet/specs/approved/ is the gauntlet-arbiter's lane. An approved "
    "spec is written there by the reviewer that approved it, and by nothing "
    "else: it is the only evidence the blind gauntlet-testsmith has that the "
    "behavior it is about to pin was reviewed. Draft under "
    "docs/gauntlet/specs/drafts/ and send the draft to the gauntlet-arbiter. "
    "(hooks/specs-lane.py)"
)
_BASH = (
    "A shell write naming a docs/gauntlet/specs/approved/ path is denied: "
    + _LANE + " Restoring an approved spec from a git object is the one shell "
    "shape that passes: "
    "`git restore --source <rev> -- docs/gauntlet/specs/approved/<file>`."
)


def _write_verdict(target: str, cwd: str, agent: str) -> str | None:
    if not sh.path_in_lane(target, cwd, LANE):
        return None
    return None if agent == REVIEWER else _LANE


def _bash_verdict(command: str) -> str | None:
    return _BASH if sh.lane_write_in(command, BASH_APPROVED) else None


def _verdict(name: str, tool_input: dict, payload: dict) -> str | None:
    """Why this call is refused, or None to let it through."""
    cwd = payload.get("cwd") or os.getcwd()
    agent = payload.get("agent_type") or ""
    if name in WRITE_TOOLS:
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _write_verdict(target, cwd, agent) if target else None
    if name == "Bash":
        return _bash_verdict(tool_input.get("command", ""))
    return None


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        return  # never block on our own failure
    reason = _verdict(data.get("tool_name", ""), data.get("tool_input") or {}, data)
    if reason is not None:
        print(sh.deny(reason))


def self_test() -> int:
    """Pin the three spec lines of the approved-spec lane."""
    root = "/repo"

    def write(path: str, agent: str | None = None) -> str | None:
        payload = {"cwd": root}
        if agent:
            payload["agent_type"] = agent
        return _verdict("Edit", {"file_path": path}, payload)

    def bash(cmd: str) -> str | None:
        return _verdict("Bash", {"command": cmd}, {"cwd": root})

    denied, allowed = (lambda v: isinstance(v, str)), (lambda v: v is None)
    lines = {
        "1 docs/gauntlet/specs/approved/ closed to every agent but the gauntlet-arbiter": all(
            (
                denied(write(f"{root}/docs/gauntlet/specs/approved/slug.txt")),
                denied(write("docs/gauntlet/specs/approved/slug.txt")),
                denied(write(f"{root}/docs/gauntlet/specs/approved/slug.txt", "gauntlet-testsmith")),
                denied(write(f"{root}/docs/gauntlet/specs/approved/slug.txt", "cavecrew-builder")),
                #: the unprefixed name is a different agent and holds no lane
                denied(write(f"{root}/docs/gauntlet/specs/approved/slug.txt", "arbiter")),
                allowed(write(f"{root}/docs/gauntlet/specs/approved/slug.txt", REVIEWER)),
            )
        ),
        "2 every other path stays open, drafts and the retired lane included": all(
            (
                allowed(write(f"{root}/docs/gauntlet/specs/drafts/slug.txt")),
                allowed(write(f"{root}/docs/gauntlet/plans/drafts/slug.txt")),
                allowed(write(f"{root}/specs/approved/slug.txt")),
                allowed(write(f"{root}/tests/approved/t.py")),
                allowed(write(f"{root}/docs/lane.txt", "gauntlet-testsmith")),
            )
        ),
        "3 shell writes naming the lane denied, reads and object restores pass": all(
            (
                denied(bash("sed -i 's/a/b/' docs/gauntlet/specs/approved/slug.txt")),
                denied(bash("echo x > docs/gauntlet/specs/approved/slug.txt")),
                denied(bash("cat draft.txt > docs/gauntlet/specs/approved/slug.txt")),
                denied(bash("cp draft.txt docs/gauntlet/specs/approved/slug.txt")),
                denied(bash("rm docs/gauntlet/specs/approved/slug.txt")),
                denied(bash("cat > docs/gauntlet/specs/approved/slug.txt <<'EOF'\nkind: new\nEOF")),
                allowed(bash("cat docs/gauntlet/specs/approved/slug.txt")),
                allowed(bash("grep -n 'kills:' docs/gauntlet/specs/approved/slug.txt")),
                allowed(bash("git status --porcelain docs/gauntlet/specs/approved/")),
                allowed(bash("git restore --source abc1234 -- docs/gauntlet/specs/approved/slug.txt")),
                allowed(bash("git checkout abc1234 -- docs/gauntlet/specs/approved/slug.txt")),
                allowed(bash("git commit -m 'spec: approved docs/gauntlet/specs/approved/slug.txt'")),
                allowed(bash("rm -rf build/ && cat docs/gauntlet/specs/approved/slug.txt")),
            )
        ),
    }
    for label, ok in lines.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(lines.values()) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
