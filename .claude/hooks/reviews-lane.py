#!/usr/bin/env python3
"""PreToolUse hook: `<gauntlet dir>/reviews/` is the reviewers' lane, and nearly their only one.

Wired session-wide from `.claude/settings.json`, so it binds the main agent
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-arbiter.md` and `.claude/agents/gauntlet-prosecutor.md`, where
the same script confines those two agents to what they are allowed to write.

The rule it enforces: a reviewer's verdict reaches the rest of the chain from a
file the reviewer wrote itself, `<gauntlet dir>/reviews/<slug>.<N>.txt`, never
from a transcription the main agent typed. A verdict that passes through
another agent's hands on the way is a verdict that agent can soften.

Each reviewer has a second write, and exactly one: the `gauntlet-arbiter` the
approved block at `<gauntlet dir>/specs/approved/<slug>.txt`, and the `gauntlet-prosecutor`
the approved plan at `<gauntlet dir>/plans/approved/<slug>.txt`, each written on `READY`
and on nothing else. That is the same rule in the other direction — the file a
later stage works from is written by the gate itself — so this hook must allow
both or each reviewer is locked out of the lane `specs-lane.py` and
`plans-lane.py` reserve for it. Neither write is the other's: the
`gauntlet-prosecutor` approves no spec, and the `gauntlet-arbiter` approves no plan.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under `<gauntlet dir>/reviews/`
    of any checkout, unless the caller's `agent_type` is `gauntlet-arbiter` or
    `gauntlet-prosecutor`
  * for those two agents, any `Write`/`Edit`/`NotebookEdit` outside
    `<gauntlet dir>/reviews/`, except the `gauntlet-arbiter` writing under
    `<gauntlet dir>/specs/approved/` and the `gauntlet-prosecutor` under
    `<gauntlet dir>/plans/approved/`
  * for those two agents, any `Bash` command that writes anything at all
  * for those two agents, a `Read` or a `Grep` aimed under
    `<gauntlet dir>/reviews/`, and a read-only `Bash` command naming such a path
  * for everyone else, a `Bash` command that writes and that names a
    `<gauntlet dir>/reviews/` path

A reviewer is denied the lane's contents as well as its writes, and a prior
round reaches a reviewer only as the carried verdicts in the main agent's own
return. That denial puts the numbering out of the reviewer's reach, so it
belongs to `scripts/pair.sh review <slug>`: it counts the directory from
outside and prints the one path the reviewer writes, which the brief carries
verbatim. A
reviewer that picks its own `<N>` under this denial is guessing, and a guess
that lands on a number already taken overwrites a round held in no git object.

Allowed: every read-only command naming `<gauntlet dir>/reviews/` for everyone but
those two agents, git commands that never write the working tree, `Glob` for
anyone, and every write elsewhere by every non-reviewer. A reviewer's suite
run counts as read-only in every form `shell_shapes.is_runner` recognizes —
`pytest`, `python -m pytest`, `node --test`, `npm test`, `npx vitest`, and the
invocations this repo declares in `blind-reads.json` — and an
interpreter handed an inline script (`-e`, `-c`, `--eval`) counts as a write
in all of them, which is the distinction a head word cannot make.
`<gauntlet dir>/reviews/` is meant to be gitignored, so there is no git object to
restore from and no restore carve-out.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent. If a build omits the key for subagents too, a reviewer is
over-denied, which is the safe direction: nothing leaks, and the denial names
this file.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

SPEC_REVIEWER = "gauntlet-arbiter"
PLAN_REVIEWER = "gauntlet-prosecutor"
REVIEWERS = frozenset({SPEC_REVIEWER, PLAN_REVIEWER})
#: tools that hand back a file's contents; `Glob` returns names only and is not one
READ_TOOLS = ("Read", "Grep")
LANE = sh.reviews_lane()
APPROVED = sh.specs_lane()
PLANS = sh.plans_lane()
#: the one approved-artifact lane each reviewer writes, and no other's
SECOND_WRITE = {SPEC_REVIEWER: APPROVED, PLAN_REVIEWER: PLANS}
BASH_REVIEWS = sh.lane_pattern(LANE)

_LANE = (
    f"{LANE}/ is the reviewers' lane: a verdict file is written by "
    "the gauntlet-arbiter or gauntlet-prosecutor that produced it, and the chain reads "
    "the verdict from that file. Nothing else writes there. "
    "(hooks/reviews-lane.py)"
)
_REVIEWER_LANE = (
    f"Reviewer: your verdict goes to {LANE}/<slug>.<N>.txt of the "
    "main checkout, the gauntlet-arbiter's approved block to "
    f"{APPROVED}/<slug>.txt, and the gauntlet-prosecutor's approved plan to "
    f"{PLANS}/<slug>.txt. Nowhere else: not the source tree, not {sh.tests_dir()}/, "
    f"not the rest of {sh.docs_dir()}/, and not the other reviewer's lane. "
    "(hooks/reviews-lane.py)"
)
_REVIEWER_BASH = (
    "Reviewer: a shell command that changes anything is denied; your writes are "
    f"the Write tool onto {LANE}/ and, on READY, {APPROVED}/ "
    f"for the gauntlet-arbiter or {PLANS}/ for the gauntlet-prosecutor. "
    "Read-only shell passes: cat, grep, sed -n, and a suite run "
    "in any of its recognized forms (pytest, python -m pytest, node --test, "
    "npm test, npx vitest, and the invocations this repo declares in "
    "blind-reads.json). An interpreter given an inline script (-e, -c, "
    "--eval) is a write, whatever it does. (hooks/reviews-lane.py)"
)
_REVIEWER_READ = (
    f"Reviewer: {LANE}/ is not yours to read. A prior round reaches "
    "you as the carried verdicts in the main agent's return, never as a file: the round "
    "that rejected a brief printed the steering back verbatim, and it is written "
    "nowhere for you to find. The path you write is not yours to count either: "
    "your brief carries it, from `scripts/pair.sh review <slug>`. "
    "(hooks/reviews-lane.py)"
)
_BASH = sh.lane_denial(LANE, "", _LANE, restore=False)


def _write_verdict(target: str, cwd: str, agent: str) -> str | None:
    in_reviews = sh.path_in_lane(target, cwd, LANE)
    if agent not in REVIEWERS:
        return _LANE if in_reviews else None
    if in_reviews:
        return None
    #: each reviewer's one other lane, and never the other reviewer's
    second = SECOND_WRITE[agent]
    if sh.path_in_lane(target, cwd, second):
        return None
    return _REVIEWER_LANE


def _read_verdict(tool_input: dict, cwd: str, agent: str) -> str | None:
    """A reviewer reads no round file; `Read` names one, `Grep` names a set."""
    if agent not in REVIEWERS:
        return None
    targets = (tool_input.get("file_path"), tool_input.get("path"), tool_input.get("glob"))
    aimed = any(t and sh.path_in_lane(t, cwd, LANE) for t in targets)
    return _REVIEWER_READ if aimed else None


def _bash_verdict(command: str, agent: str) -> str | None:
    if agent in REVIEWERS:
        if sh.command_writes(command, restore_ok=False):
            return _REVIEWER_BASH
        return _REVIEWER_READ if BASH_REVIEWS.search(command) else None
    return _BASH if sh.lane_write_in(command, BASH_REVIEWS, restore_ok=False) else None


def _verdict(name: str, tool_input: dict, payload: dict) -> str | None:
    """Why this call is refused, or None to let it through."""
    return sh.dispatch(
        name,
        tool_input,
        payload,
        on_write=_write_verdict,
        on_bash=_bash_verdict,
        on_read=_read_verdict,
        read_tools=READ_TOOLS,
    )


def main() -> None:
    sh.hook_main(_verdict)


def self_test() -> int:
    """Pin the five spec lines of the reviewers' lane."""
    root = "/repo"

    #: the lines below spell the kit's defaults; under a project that moved one
    #: of the three directories, the same lines run at that project's own
    write = sh.rebased(sh.probe(_verdict, root, "Write"))
    read = sh.rebased(sh.probe(_verdict, root, "Read"))
    bash = sh.rebased(sh.probe(_verdict, root, "Bash", "command"))
    denied, allowed = sh.denied, sh.allowed
    lines = {
        "1 gauntlet/reviews/ closed to everyone but the two reviewers": all(
            (
                denied(write(f"{root}/gauntlet/reviews/slug.1.txt")),
                denied(write(f"{root}/gauntlet/reviews/slug.1.txt", "gauntlet-scrivener")),
                #: an unprefixed same-named agent in the host project is not this one
                denied(write(f"{root}/gauntlet/reviews/slug.1.txt", "arbiter")),
                denied(write(f"{root}/gauntlet/reviews/slug.1.txt", "prosecutor")),
                allowed(write(f"{root}/gauntlet/reviews/slug.1.txt", SPEC_REVIEWER)),
                allowed(write(f"{root}/gauntlet/reviews/slug.1.txt", PLAN_REVIEWER)),
                denied(bash("echo x > gauntlet/reviews/slug.1.txt")),
                allowed(bash("cat gauntlet/reviews/slug.1.txt")),
            )
        ),
        "2 a reviewer writes its verdict and nothing else": all(
            (
                denied(write(f"{root}/src/m.py", SPEC_REVIEWER)),
                denied(write(f"{root}/tests/t.py", SPEC_REVIEWER)),
                denied(write(f"{root}/docs/testing.md", PLAN_REVIEWER)),
                denied(write(f"{root}/gauntlet/plans/drafts/slug.txt", PLAN_REVIEWER)),
                denied(bash("sed -i 's/a/b/' src/m.py", SPEC_REVIEWER)),
                allowed(bash("git show HEAD:gauntlet/specs/approved/slug.txt", SPEC_REVIEWER)),
                allowed(bash("grep -rn 'def test_' tests/", SPEC_REVIEWER)),
                #: the suite run this file promises a reviewer, in the spellings
                #: a head-word reader list cannot tell apart from a write
                allowed(bash("pytest tests/ -q", SPEC_REVIEWER)),
                allowed(bash("python -m pytest tests/ -q", SPEC_REVIEWER)),
                denied(bash("python -c \"open('x','w')\"", SPEC_REVIEWER)),
                denied(bash("node -e \"require('fs').writeFileSync('x','')\"", SPEC_REVIEWER)),
                denied(bash("make clean", SPEC_REVIEWER)),
            )
        ),
        "3 the gauntlet-arbiter alone also writes gauntlet/specs/approved/": all(
            (
                allowed(write(f"{root}/gauntlet/specs/approved/slug.txt", SPEC_REVIEWER)),
                denied(write(f"{root}/gauntlet/specs/approved/slug.txt", PLAN_REVIEWER)),
                denied(write(f"{root}/gauntlet/specs/drafts/slug.txt", SPEC_REVIEWER)),
            )
        ),
        "4 the gauntlet-prosecutor alone also writes gauntlet/plans/approved/": all(
            (
                allowed(write(f"{root}/gauntlet/plans/approved/slug.txt", PLAN_REVIEWER)),
                denied(write(f"{root}/gauntlet/plans/approved/slug.txt", SPEC_REVIEWER)),
                denied(write(f"{root}/docs/plans.md", PLAN_REVIEWER)),
            )
        ),
        "5 a reviewer never reads the round files": all(
            (
                denied(read(f"{root}/gauntlet/reviews/slug.1.txt", SPEC_REVIEWER)),
                denied(read(f"{root}/gauntlet/reviews/slug.1.txt", PLAN_REVIEWER)),
                denied(bash("cat gauntlet/reviews/slug.1.txt", SPEC_REVIEWER)),
                allowed(read(f"{root}/gauntlet/reviews/slug.1.txt")),
                allowed(read(f"{root}/tests/t.py", SPEC_REVIEWER)),
            )
        ),
        "6 read-only git naming the lane passes, its write forms do not": all(
            (
                allowed(bash("git grep -n foo -- gauntlet/reviews/")),
                allowed(bash("git grep -n 'gauntlet/reviews/' -- .claude/hooks")),
                allowed(bash("git ls-tree HEAD gauntlet/reviews/")),
                denied(bash("git grep -Ovim foo -- gauntlet/reviews/")),
                denied(bash("git diff --output=gauntlet/reviews/x.txt")),
            )
        ),
        "7 a reviewer's read-only git passes, its write forms do not": all(
            (
                allowed(bash("git grep foo", SPEC_REVIEWER)),
                denied(bash("git grep foo -- gauntlet/reviews/", SPEC_REVIEWER)),
                denied(bash("git reflog expire --all", SPEC_REVIEWER)),
                denied(bash("git diff --output=out.txt", SPEC_REVIEWER)),
            )
        ),
        "8 the lane is what a write targets, not what its text mentions": all(
            (
                allowed(
                    bash(
                        "cat > state/notes.txt <<EOF\n"
                        "round file is gauntlet/reviews/slug.1.txt\nEOF"
                    )
                ),
                allowed(bash("echo 'gauntlet/reviews/slug.1.txt' >> notes.txt")),
                allowed(bash('for c in "tee gauntlet/reviews/a.txt"; do echo "$c"; done')),
                allowed(bash("find gauntlet/reviews -name 'slug.*'")),
                allowed(bash("ls gauntlet/reviews/")),
                denied(bash("printf '%s' x | tee gauntlet/reviews/slug.1.txt")),
                denied(bash("find gauntlet/reviews -name 'slug.*' -delete")),
            )
        ),
        "9 a reviewer's readers are reads, and the rounds stay closed to it": all(
            (
                #: the same readers, asked for the reviewer, whose shell is
                #: judged on whether it writes at all rather than on a lane path
                allowed(bash("find tests -name '*.py'", SPEC_REVIEWER)),
                allowed(bash("find tests -name '*.py' | xargs grep -n foo", PLAN_REVIEWER)),
                allowed(bash("awk '{print}' docs/testing.md", SPEC_REVIEWER)),
                allowed(
                    bash(
                        "cmp gauntlet/specs/drafts/slug.txt gauntlet/specs/approved/slug.txt",
                        SPEC_REVIEWER,
                    )
                ),
                allowed(bash(".venv/bin/ruff check tests", PLAN_REVIEWER)),
                denied(bash("find tests -name '*.py' -delete", SPEC_REVIEWER)),
                #: reading the rounds is the denial `scripts/pair.sh review`
                #: exists to make survivable: the path is handed to the
                #: reviewer, so it never counts the directory itself
                denied(bash("ls gauntlet/reviews/", SPEC_REVIEWER)),
                denied(bash("find gauntlet/reviews -name 'slug.*'", PLAN_REVIEWER)),
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
