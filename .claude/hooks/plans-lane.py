#!/usr/bin/env python3
"""PreToolUse hook: `docs/gauntlet/plans/approved/` is the gauntlet-prosecutor's lane.

Wired session-wide from `.claude/settings.json`, so it binds the orchestrator
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-prosecutor.md`.

This is the rule `specs-lane.py` holds for the spec gate, one stage earlier.
A plan that reached `READY` is what the implementation is measured against, and
a session picking the chain up at any later stage reads it from disk rather
than inheriting it. If the agent that wants a plan through can also write the
file, approval is a formality: the orchestrator states the plan, drops it in
the folder, and the adversarial review it was supposed to survive never
happened. So the file is written by one hand, the one that holds the gate.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under a
    `docs/gauntlet/plans/approved/` directory, unless the caller's
    `agent_type` is `gauntlet-prosecutor`
  * a `Bash` command that names a `docs/gauntlet/plans/approved/` path and is
    not read-only, except a restore from a named git object
    (`git restore --source <rev>` or `git checkout <rev> --` onto the path),
    which copies a commit and types nothing

Allowed: every read of the lane, by any agent and by the shell; every write
anywhere else, including a draft plan under `docs/gauntlet/plans/drafts/`.
The lane prefix ends at `approved`, so the drafts folder beside it needs no
carve-out.

`agent_type` is present in the payload only for subagent calls; an absent key
is the orchestrator, which is denied. If a build omits the key for subagents
too, the gauntlet-prosecutor is over-denied, which is the safe direction: no
unreviewed plan reaches the tree, and the denial names this file.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

REVIEWER = "gauntlet-prosecutor"
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
LANE = "docs/gauntlet/plans/approved"
BASH_APPROVED = sh.lane_pattern(LANE)

_LANE = (
    "docs/gauntlet/plans/approved/ is the gauntlet-prosecutor's lane. An "
    "approved plan is written there by the reviewer that approved it, and by "
    "nothing else: it is the only evidence a later stage has that the plan it "
    "works from passed the plan gate. Draft under "
    "docs/gauntlet/plans/drafts/ and send the draft to the "
    "gauntlet-prosecutor. (hooks/plans-lane.py)"
)
_BASH = (
    "A shell write naming a docs/gauntlet/plans/approved/ path is denied: "
    + _LANE
    + " Restoring an approved plan from a git object is the one shell shape "
    "that passes: "
    "`git restore --source <rev> -- docs/gauntlet/plans/approved/<file>`."
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
    """Pin the four spec lines of the approved-plan lane."""
    root = "/repo"

    def write(path: str, agent: str | None = None) -> str | None:
        payload = {"cwd": root}
        if agent:
            payload["agent_type"] = agent
        return _verdict("Edit", {"file_path": path}, payload)

    def bash(cmd: str) -> str | None:
        return _verdict("Bash", {"command": cmd}, {"cwd": root})

    denied, allowed = (lambda v: isinstance(v, str)), (lambda v: v is None)
    lane = f"{root}/docs/gauntlet/plans/approved"
    lines = {
        "1 the lane is closed to every agent but the gauntlet-prosecutor": all(
            (
                denied(write(f"{lane}/slug.txt")),
                denied(write("docs/gauntlet/plans/approved/slug.txt")),
                denied(write(f"{lane}/slug.txt", "gauntlet-arbiter")),
                denied(write(f"{lane}/slug.txt", "gauntlet-testsmith")),
                #: an unprefixed same-named agent in another project is not this one
                denied(write(f"{lane}/slug.txt", "prosecutor")),
                allowed(write(f"{lane}/slug.txt", REVIEWER)),
                allowed(write(f"{lane}/other.txt", REVIEWER)),
            )
        ),
        "2 every other path stays open, the drafts beside it included": all(
            (
                allowed(write(f"{root}/docs/gauntlet/plans/drafts/slug.txt")),
                allowed(write(f"{root}/docs/gauntlet/plans/drafts/other.txt")),
                allowed(write(f"{root}/docs/gauntlet/specs/approved/slug.txt", "gauntlet-arbiter")),
                allowed(write(f"{root}/docs/plans.md")),
                allowed(write(f"{root}/tests/plans/t.py")),
            )
        ),
        "3 shell writes naming the lane denied, reads and object restores pass": all(
            (
                denied(bash("rm docs/gauntlet/plans/approved/slug.txt")),
                denied(bash("mv /tmp/x.txt docs/gauntlet/plans/approved/slug.txt")),
                denied(bash("sed -i 's/a/b/' docs/gauntlet/plans/approved/slug.txt")),
                denied(bash("echo x > docs/gauntlet/plans/approved/slug.txt")),
                denied(bash("cp draft.txt docs/gauntlet/plans/approved/slug.txt")),
                denied(bash("cat > docs/gauntlet/plans/approved/slug.txt <<'EOF'\nslug: x\nEOF")),
                allowed(bash("cat docs/gauntlet/plans/approved/slug.txt")),
                allowed(bash("grep -n 'slug:' docs/gauntlet/plans/approved/slug.txt")),
                allowed(bash("git status --porcelain docs/gauntlet/plans/approved/")),
                allowed(bash("git restore --source abc1234 -- docs/gauntlet/plans/approved/s.txt")),
                allowed(bash("git checkout abc1234 -- docs/gauntlet/plans/approved/slug.txt")),
                allowed(bash("git commit -m 'plan: docs/gauntlet/plans/approved/slug.txt'")),
            )
        ),
        "4 the lane directory itself is in the lane, checkout or not": all(
            (
                #: outside any checkout the path is read off its own segments, and
                #: the last segment is one of them: the write that creates the
                #: directory is the lane's first write, not its exception
                denied(write("/nogit/docs/gauntlet/plans/approved/slug.txt")),
                allowed(write("/nogit/docs/gauntlet/plans/drafts/slug.txt")),
                allowed(write(lane, REVIEWER)),
            )
        ),
    }
    for label, ok in lines.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(lines.values()) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
