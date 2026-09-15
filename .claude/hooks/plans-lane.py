#!/usr/bin/env python3
"""PreToolUse hook: `<gauntlet dir>/plans/approved/` is the gauntlet-prosecutor's lane.

Wire it session-wide from `.claude/settings.json`, so it binds the main agent
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-prosecutor.md`.

This is the rule `specs-lane.py` holds for the spec gate, one stage earlier.
A plan that reached `READY` is the thing the implementation is measured
against, and a fresh agent picking the chain up at any later stage reads it
from disk rather than inheriting it. If the agent that wants a plan through
can also write the file, approval is a formality: the main agent states the
plan, drops it in the folder, and the adversarial review it was supposed to
survive never happened. So the file is written by exactly one hand, the one
that holds the gate.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under a
    `<gauntlet dir>/plans/approved/` directory, unless the caller's `agent_type` is
    `gauntlet-prosecutor`
  * a `Bash` command that names a `<gauntlet dir>/plans/approved/` path and is not
    read-only, except a restore from a named git object
    (`git restore --source <rev>` or `git checkout <rev> --` onto the path),
    which copies a commit and types nothing

Allowed: every read of `<gauntlet dir>/plans/approved/`, by any agent and by the shell;
every write anywhere else, including a draft plan under
`<gauntlet dir>/plans/drafts/`.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent, which is denied. If a build omits the key for subagents
too, the gauntlet-prosecutor is over-denied, which is the safe direction: no
unreviewed plan reaches the tree, and the denial names this file.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

REVIEWER = "gauntlet-prosecutor"
LANE = sh.plans_lane()
#: where an unreviewed plan is drafted: beside the lane, never in it
DRAFTS = sh.gauntlet_dir() + "/plans/drafts"

_LANE = (
    f"{LANE}/ is the gauntlet-prosecutor's lane. An approved plan is "
    "written there by the reviewer that approved it, and by nothing else: it is "
    "the only evidence a later stage has that the plan it works from passed the "
    f"plan gate. Draft under {DRAFTS}/ and send the draft to the "
    "gauntlet-prosecutor. (hooks/plans-lane.py)"
)
_BASH = sh.lane_denial(LANE, "an approved plan", _LANE)

#: the lane's whole policy: the one writer passes, every other hand is
#: refused with the reason, and a shell write into it is refused with _BASH
_verdict = sh.sole_writer_lane(LANE, REVIEWER, _LANE, _BASH)


def main() -> None:
    sh.hook_main(_verdict)


def self_test() -> int:
    """Pin the four spec lines of the approved-plan lane."""
    root = "/repo"

    write, bash = sh.probes(_verdict, root)
    denied, allowed = sh.denied, sh.allowed
    lines = {
        "1 gauntlet/plans/approved/ closed to every agent but the gauntlet-prosecutor": all(
            (
                denied(write(f"{root}/gauntlet/plans/approved/slug.txt")),
                denied(write("gauntlet/plans/approved/slug.txt")),
                denied(write(f"{root}/gauntlet/plans/approved/slug.txt", "gauntlet-arbiter")),
                denied(write(f"{root}/gauntlet/plans/approved/slug.txt", "gauntlet-scrivener")),
                #: an unprefixed same-named agent in the host project is not this one
                denied(write(f"{root}/gauntlet/plans/approved/slug.txt", "prosecutor")),
                allowed(write(f"{root}/gauntlet/plans/approved/slug.txt", REVIEWER)),
            )
        ),
        "2 every other path stays open, drafts included": all(
            (
                allowed(write(f"{root}/gauntlet/plans/drafts/slug.txt")),
                allowed(write(f"{root}/gauntlet/specs/approved/slug.txt", "gauntlet-arbiter")),
                allowed(write(f"{root}/docs/plans.md")),
                allowed(write(f"{root}/tests/plans/t.py")),
            )
        ),
        "3 shell writes naming the lane denied, reads and object restores pass": all(
            (
                denied(bash("sed -i 's/a/b/' gauntlet/plans/approved/slug.txt")),
                denied(bash("echo x > gauntlet/plans/approved/slug.txt")),
                denied(bash("cp draft.txt gauntlet/plans/approved/slug.txt")),
                denied(bash("rm gauntlet/plans/approved/slug.txt")),
                denied(bash("cat > gauntlet/plans/approved/slug.txt <<'EOF'\nslug: x\nEOF")),
                allowed(bash("cat gauntlet/plans/approved/slug.txt")),
                allowed(bash("grep -n 'kind:' gauntlet/plans/approved/slug.txt")),
                allowed(bash("git status --porcelain gauntlet/plans/approved/")),
                allowed(bash("git restore --source abc1234 -- gauntlet/plans/approved/slug.txt")),
                allowed(bash("git checkout abc1234 -- gauntlet/plans/approved/slug.txt")),
                allowed(bash("git commit -m 'plan: gauntlet/plans/approved/slug.txt'")),
            )
        ),
        "4 the lane directory itself is in the lane, checkout or not": all(
            (
                #: outside any checkout the path is read off its own segments, and
                #: the last segment is one of them: the write that creates the
                #: directory is the lane's first write, not its exception
                denied(write("/nogit/gauntlet/plans/approved")),
                denied(write("/nogit/gauntlet/plans/approved/slug.txt")),
                allowed(write("/nogit/gauntlet/plans/drafts/slug.txt")),
                allowed(write(f"{root}/gauntlet/plans/approved", REVIEWER)),
            )
        ),
        "5 read-only git naming the lane passes, its write forms do not": all(
            (
                allowed(bash("git grep -n foo -- gauntlet/plans/approved/")),
                allowed(bash("git grep -n 'gauntlet/plans/approved/' -- .claude/hooks")),
                allowed(bash("git ls-tree HEAD gauntlet/plans/approved/")),
                denied(bash("git grep -Ovim foo -- gauntlet/plans/approved/")),
                denied(bash("git diff --output=gauntlet/plans/approved/x.txt")),
            )
        ),
        "6 the blind runner naming this lane is still denied": all(
            (
                #: the runner takes one path under the test directory, so it
                #: reaches no other lane however the argument is spelled
                denied(bash("scripts/blind.sh test gauntlet/plans/approved/slug.txt")),
                denied(bash("scripts/blind.sh test tests/a/../../gauntlet/plans/approved/slug.txt")),
            )
        ),
        "7 the lane is what a write targets, not what its text mentions": all(
            (
                allowed(
                    bash(
                        "cat > gauntlet/plans/drafts/slug.txt <<EOF\n"
                        "cites gauntlet/plans/approved/other.txt\nEOF"
                    )
                ),
                allowed(bash("echo 'gauntlet/plans/approved/slug.txt' >> notes.txt")),
                allowed(bash("find gauntlet/plans/approved -name '*.txt'")),
                allowed(bash("cmp gauntlet/plans/drafts/slug.txt gauntlet/plans/approved/slug.txt")),
                denied(bash("cat draft.txt > gauntlet/plans/approved/slug.txt")),
                denied(bash("find gauntlet/plans/approved -name '*.txt' -delete")),
            )
        ),
        #: a hook decides a tool call, so its own crash is a denial -- and a
        #: payload it cannot read is a call it cannot decide, which is a refusal
        "every payload shape is answered, and an unreadable one is refused": (
            sh.survives_hostile_payloads(__file__)
        ),
    }
    return sh.report(lines)


if __name__ == "__main__":
    sh.entry(self_test, main)
