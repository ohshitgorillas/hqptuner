#!/usr/bin/env python3
"""PreToolUse hook: `<gauntlet dir>/specs/approved/` is the gauntlet-arbiter's lane.

Wire it session-wide from `.claude/settings.json`, so it binds the main agent
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-arbiter.md` and `.claude/agents/gauntlet-scrivener.md`.

An approved spec is the only thing the blind `gauntlet-scrivener` works from. If the
agent that wants a test can also write the file the test is generated from,
approval is a formality: the main agent states the behavior, hands it to the
writer, and the adversarial review it was supposed to survive never happened.
So the file is written by exactly one hand, the one that holds the gate.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under a `<gauntlet dir>/specs/approved/`
    directory, unless the caller's `agent_type` is `gauntlet-arbiter`
  * a `Bash` command that names a `<gauntlet dir>/specs/approved/` path and is not
    read-only, except a restore from a named git object
    (`git restore --source <rev>` or `git checkout <rev> --` onto the path),
    which copies a commit and types nothing

Allowed: every read of `<gauntlet dir>/specs/approved/`, by any agent and by the shell;
every write anywhere else, including a draft spec under
`<gauntlet dir>/specs/drafts/`.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent, which is denied. If a build omits the key for subagents
too, the gauntlet-arbiter is over-denied, which is the safe direction: no
unreviewed spec reaches the writer, and the denial names this file.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

REVIEWER = "gauntlet-arbiter"
LANE = sh.specs_lane()
#: where an unreviewed block is drafted: beside the lane, never in it
DRAFTS = sh.gauntlet_dir() + "/specs/drafts"

_LANE = (
    f"{LANE}/ is the gauntlet-arbiter's lane. An approved spec is "
    "written there by the reviewer that approved it, and by nothing else: it is "
    "the only evidence the blind gauntlet-scrivener has that the behavior it is about "
    f"to pin was reviewed. Draft under {DRAFTS}/ and send the draft "
    "to the gauntlet-arbiter. (hooks/specs-lane.py)"
)
_BASH = sh.lane_denial(LANE, "an approved spec", _LANE)

#: the lane's whole policy: the one writer passes, every other hand is
#: refused with the reason, and a shell write into it is refused with _BASH
_verdict = sh.sole_writer_lane(LANE, REVIEWER, _LANE, _BASH)


def main() -> None:
    sh.hook_main(_verdict)


def self_test() -> int:
    """Pin the three spec lines of the approved-spec lane."""
    root = "/repo"

    write, bash = sh.probes(_verdict, root)
    denied, allowed = sh.denied, sh.allowed
    lines = {
        "1 gauntlet/specs/approved/ closed to every agent but the gauntlet-arbiter": all(
            (
                denied(write(f"{root}/gauntlet/specs/approved/slug.txt")),
                denied(write("gauntlet/specs/approved/slug.txt")),
                denied(write(f"{root}/gauntlet/specs/approved/slug.txt", "gauntlet-scrivener")),
                denied(write(f"{root}/gauntlet/specs/approved/slug.txt", "cavecrew-builder")),
                #: an unprefixed same-named agent in the host project is not this one
                denied(write(f"{root}/gauntlet/specs/approved/slug.txt", "arbiter")),
                allowed(write(f"{root}/gauntlet/specs/approved/slug.txt", REVIEWER)),
            )
        ),
        "2 every other path stays open, drafts included": all(
            (
                allowed(write(f"{root}/gauntlet/specs/drafts/slug.txt")),
                allowed(write(f"{root}/gauntlet/plans/approved/slug.txt")),
                allowed(write(f"{root}/tests/specs/t.py")),
                allowed(write(f"{root}/docs/lane.txt", "gauntlet-scrivener")),
            )
        ),
        "3 shell writes naming the lane denied, reads and object restores pass": all(
            (
                denied(bash("sed -i 's/a/b/' gauntlet/specs/approved/slug.txt")),
                denied(bash("echo x > gauntlet/specs/approved/slug.txt")),
                denied(bash("cat draft.txt > gauntlet/specs/approved/slug.txt")),
                denied(bash("cp draft.txt gauntlet/specs/approved/slug.txt")),
                denied(bash("rm gauntlet/specs/approved/slug.txt")),
                denied(bash("cat > gauntlet/specs/approved/slug.txt <<'EOF'\nkind: new\nEOF")),
                allowed(bash("cat gauntlet/specs/approved/slug.txt")),
                allowed(bash("grep -n 'kills:' gauntlet/specs/approved/slug.txt")),
                allowed(bash("git status --porcelain gauntlet/specs/approved/")),
                allowed(bash("git restore --source abc1234 -- gauntlet/specs/approved/slug.txt")),
                allowed(bash("git checkout abc1234 -- gauntlet/specs/approved/slug.txt")),
                allowed(bash("git commit -m 'spec: approved gauntlet/specs/approved/slug.txt'")),
                allowed(bash("rm -rf build/ && cat gauntlet/specs/approved/slug.txt")),
            )
        ),
        "4 the lane directory itself is in the lane, checkout or not": all(
            (
                #: outside any checkout the path is read off its own segments, and
                #: the last segment is one of them: the write that creates the
                #: directory is the lane's first write, not its exception
                denied(write("/nogit/gauntlet/specs/approved")),
                denied(write("/nogit/gauntlet/specs/approved/slug.txt")),
                allowed(write("/nogit/gauntlet/specs/drafts/slug.txt")),
                allowed(write(f"{root}/gauntlet/specs/approved", REVIEWER)),
            )
        ),
        "5 read-only git naming the lane passes, its write forms do not": all(
            (
                allowed(bash("git grep -n foo -- gauntlet/specs/approved/")),
                allowed(bash("git grep -n 'gauntlet/specs/approved/' -- .claude/hooks")),
                allowed(bash("git ls-tree HEAD gauntlet/specs/approved/")),
                denied(bash("git grep -Ovim foo -- gauntlet/specs/approved/")),
                denied(bash("git diff --output=gauntlet/specs/approved/x.txt")),
            )
        ),
        "6 the blind runner naming this lane is still denied": all(
            (
                #: the runner takes one path under the test directory, so it
                #: reaches no other lane however the argument is spelled
                denied(bash("scripts/blind.sh test gauntlet/specs/approved/slug.txt")),
                denied(bash("scripts/blind.sh test tests/a/../../gauntlet/specs/approved/slug.txt")),
            )
        ),
        "7 the lane is what a write targets, not what its text mentions": all(
            (
                #: drafting is the main agent's whole job here, and a draft that
                #: quotes the approved path is a draft, not a write to the lane
                allowed(
                    bash(
                        "cat > gauntlet/specs/drafts/slug.txt <<EOF\n"
                        "see gauntlet/specs/approved/slug.txt\nEOF"
                    )
                ),
                allowed(
                    bash(
                        "git show HEAD:gauntlet/specs/approved/slug.txt"
                        " > gauntlet/specs/drafts/slug.txt"
                    )
                ),
                allowed(bash("echo 'gauntlet/specs/approved/slug.txt' >> notes.txt")),
                allowed(bash("cmp gauntlet/specs/drafts/slug.txt gauntlet/specs/approved/slug.txt")),
                allowed(bash("grep -n 'a > b' gauntlet/specs/approved/")),
                #: the same redirection pointed the other way is the lane's
                denied(
                    bash(
                        "git show HEAD:gauntlet/specs/drafts/slug.txt"
                        " > gauntlet/specs/approved/slug.txt"
                    )
                ),
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
