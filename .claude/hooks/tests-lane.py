#!/usr/bin/env python3
"""PreToolUse hook: `tests/` is the gauntlet-scrivener's lane, and only in its spec tree.

Wired session-wide from `.claude/settings.json`, so it binds the main agent
and every subagent, and again from the `hooks:` frontmatter of
`.claude/agents/gauntlet-scrivener.md`, where the same script confines that agent to
its own tree's `tests/`.

The rule it enforces: tests are written blind, from an approved spec block, by
the `gauntlet-scrivener`, in the spec worktree cut for the run. Every other hand on a
test file is the one the chain exists to keep off it: the agent that
implements the change editing a test until it passes.

Denied:

  * `Write`/`Edit`/`NotebookEdit` whose target is under `tests/` of any
    checkout, unless the caller's `agent_type` is `gauntlet-scrivener` AND the
    target is inside a `.claude/worktrees/*-spec` tree
  * for the `gauntlet-scrivener`, any `Write`/`Edit` outside its spec tree's `tests/`
  * a `Bash` command that writes and that names a `tests/` path, except a
    restore from a named git object (`git restore --source <rev>` or
    `git checkout <rev> --` onto the path), which copies a commit and types
    nothing

Allowed: every read-only command naming `tests/` (`pytest`, `cat`, `sed -n`,
`grep`), and every write elsewhere.

One lane is a script's rather than the writer's. A strike motion block names
tests to remove; a single test is an `Edit` and the writer's, but a whole file
cannot be, because this hook denies every hand the shell it would take. So
`scripts/pair.sh red` removes the whole-file targets itself, from the committed
block. This hook does not see that removal and is not meant to: it governs what
an agent types, and the script is bounded by the block it reads from git.
`scripts/strike-diff.py` checks the result at merge, against that same block.

`agent_type` is present in the payload only for subagent calls; an absent key
is the main agent. If a build omits the key for subagents too, the writer is
over-denied, which is the safe direction: nothing leaks, and the denial names
this file.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import shell_shapes as sh  # noqa: E402

WRITER = "gauntlet-scrivener"
#: `tests` unless the repo names another directory under the `tests_dir` key
#: of `blind-reads.json`; the lane hooks and the scripts read the same key
LANE = sh.tests_dir()
BASH_TESTS = sh.lane_pattern(LANE)

_LANE = (
    f"{LANE}/ is the gauntlet-scrivener's lane, written only in its spec tree from the "
    "committed spec block. A test that must change goes back through the spec: "
    "a re-approved line, a new `spec:` commit, a delta to the writer. Never by "
    "hand, never in the impl tree, never on the branch. (hooks/tests-lane.py)"
)
_WRITER_LANE = (
    f"Blind writer: you write under {LANE}/ of your own spec tree and nowhere else. "
    f"Not the source tree, not {sh.docs_dir()}/, not another worktree. (hooks/tests-lane.py)"
)
_BASH = sh.lane_denial(LANE, "a test", _LANE)


def _is_spec_tree(root: str) -> bool:
    parent, name = os.path.split(root)
    return name.endswith("-spec") and os.path.basename(parent) == "worktrees"


def _write_verdict(target: str, cwd: str, agent: str) -> str | None:
    root, rel = sh.split_root(target, cwd)
    #: outside any checkout there is no root to name, but the lane still holds:
    #: a `tests/` segment in the path is the lane, before `git init` and after
    in_tests = (
        sh.under(rel, LANE)
        if rel is not None and not rel.startswith("..")
        else sh.path_in_lane(target, cwd, LANE)
    )
    if agent == WRITER:
        return None if in_tests and root is not None and _is_spec_tree(root) else _WRITER_LANE
    return _LANE if in_tests else None


def _bash_verdict(command: str, agent: str = "") -> str | None:
    return _BASH if sh.lane_write_in(command, BASH_TESTS) else None


def _verdict(name: str, tool_input: dict, payload: dict) -> str | None:
    """Why this call is refused, or None to let it through."""
    return sh.dispatch(
        name, tool_input, payload, on_write=_write_verdict, on_bash=_bash_verdict
    )


def main() -> None:
    sh.hook_main(_verdict)


def self_test() -> int:
    """Pin the three spec lines of the test lane."""
    root = sh.checkout_root(os.path.dirname(os.path.abspath(__file__))) or "/repo"
    spec = os.path.join(root, ".claude", "worktrees", "x-spec")
    impl = os.path.join(root, ".claude", "worktrees", "x-impl")

    write, bash = sh.probes(_verdict, root)
    denied, allowed = sh.denied, sh.allowed
    lines = {
        "1 tests/ closed to all but the writer in a spec tree": all(
            (
                denied(write(f"{root}/tests/t.py")),
                denied(write(f"{impl}/tests/t.py")),
                denied(write(f"{spec}/tests/t.py")),
                denied(write(f"{impl}/tests/t.py", "cavecrew-builder")),
                #: an unprefixed same-named agent in the host project is not this one
                denied(write(f"{spec}/tests/t.py", "scrivener")),
                allowed(write(f"{spec}/tests/t.py", WRITER)),
                denied(write(f"{impl}/tests/t.py", WRITER)),
            )
        ),
        "2 writer confined to its spec tree's tests/": all(
            (
                denied(write(f"{spec}/src/m.py", WRITER)),
                denied(write(f"{spec}/docs/testing.md", WRITER)),
                allowed(write(f"{spec}/tests/conftest.py", WRITER)),
            )
        ),
        "3 shell writes naming tests/ denied, reads and object restores pass": all(
            (
                denied(bash("sed -i 's/a/b/' tests/t.py")),
                denied(bash("echo x > tests/t.py")),
                denied(bash("rm tests/t.py")),
                allowed(bash(".venv/bin/pytest tests/t.py -q")),
                allowed(bash("cat tests/t.py")),
                allowed(bash("grep -rn 'def test_' tests/")),
                allowed(bash("git restore --source abc1234 -- tests/t.py")),
                allowed(bash("git checkout abc1234 -- tests/t.py")),
                allowed(bash("git commit -m 'test: pins tests/t.py'")),
            )
        ),
        "4 a write into tests/ is a write however it is spelled": all(
            (
                #: a separator the splitter did not know left the whole command
                #: reading as its first word, so any reader in front hid a write
                denied(bash("cat tests/t.py\nrm tests/t.py")),
                denied(bash("cat README.md & rm tests/t.py")),
                #: `find` and the interpreters are write primitives, not readers
                denied(bash("find tests -name '*.py' -delete")),
                denied(bash("node -e \"require('fs').writeFileSync('tests/t.py','')\"")),
                denied(bash("python -c \"open('tests/t.py','w')\"")),
                #: a stage that cd'd into the lane writes to it without naming it
                denied(bash("cd tests && rm t.py")),
                denied(bash("cd tests; rm t.py")),
                #: and a `cd` the walk cannot follow does not carry the taint back
                allowed(bash("cd /tmp && rm t.py")),
                #: a separator inside a quoted argument is not a separator
                allowed(bash("grep -rn 'a && b' tests/")),
            )
        ),
        "5 a suite run naming tests/ is a read, an inline script is not": all(
            (
                allowed(bash("python -m pytest tests/ -q")),
                allowed(bash("python3 -m unittest discover tests/")),
                allowed(bash("node --test tests/t.test.js")),
                allowed(bash("npm test -- tests/t.py")),
                allowed(bash("npx vitest run tests/")),
                #: the same heads without the argument that makes them a run
                denied(bash("npm run build -- tests/")),
                denied(bash("npx rimraf tests/")),
                denied(bash("node -e \"require('fs').rmSync('tests/t.py')\"")),
            )
        ),
        "6 read-only git naming tests/ passes, its write forms do not": all(
            (
                allowed(bash("git grep -n foo -- tests/")),
                allowed(bash("git grep -n 'tests/' -- .claude/hooks")),
                allowed(bash("git ls-tree HEAD tests/")),
                denied(bash("git grep -Ovim foo -- tests/")),
                denied(bash("git diff --output=tests/x")),
            )
        ),
        "7 the kit's blind runner is a read, its near spellings are not": all(
            (
                allowed(bash("scripts/blind.sh test tests/t.py")),
                allowed(bash("scripts/blind.sh test .claude/worktrees/x-spec/tests/t.py")),
                #: normalizes back under the lane, so still a run
                allowed(bash("scripts/blind.sh test tests/support/../t.py")),
                #: a command word in front of the entry is not the entry
                denied(bash("bash scripts/blind.sh test tests/t.py")),
                #: the key is the whole invocation, so a write beside it stays one
                denied(bash("rm tests/t.py && scripts/blind.sh test tests/t.py")),
                #: and its arity, so a second path is not the shape
                denied(bash("scripts/blind.sh test tests/a.py tests/b.py")),
                #: an argument that opens under the prefix and walks out of it
                denied(bash("scripts/blind.sh test tests/a/../../gauntlet/plans/approved/x.txt")),
                #: another subcommand is not a run and falls to the path test
                denied(bash("scripts/blind.sh status tests")),
            )
        ),
        "8 the lane is what a write targets, not what its text mentions": all(
            (
                #: the body of a heredoc is content; the target is the
                #: redirection that opened it
                allowed(bash("cat > drafts/x.txt <<EOF\nsee tests/t.py\nEOF")),
                allowed(bash("echo 'tests/t.py' >> notes.txt")),
                #: a `for` header runs no command, so its list is strings
                allowed(bash('for c in "rm tests/t.py"; do echo "$c"; done')),
                #: a `>` inside quotes is a character, not a redirection
                allowed(bash("grep -n 'a > b' tests/")),
                #: and the same shapes aimed at the lane are still writes
                denied(bash("cat > tests/t.py <<EOF\nx\nEOF")),
                denied(bash("echo x >> tests/t.py")),
                denied(bash('cat impl.py > "tests/t.py"')),
            )
        ),
        "9 the readers a search is made of are reads": all(
            (
                allowed(bash("find tests -name '*.py'")),
                allowed(bash("find tests -name '*.py' | xargs grep -n foo")),
                allowed(bash("awk '{print}' tests/t.py")),
                allowed(bash("cmp tests/a.py tests/b.py")),
                allowed(bash(".venv/bin/ruff check tests")),
                allowed(bash(".venv/bin/ruff format --check tests")),
                #: each of them has a form that writes, and that form is one
                denied(bash("find tests -name '*.py' -delete")),
                denied(bash("find tests -name '*.py' | xargs rm")),
                denied(bash("awk '{print > \"tests/t.py\"}' a.txt")),
                denied(bash("awk -f prog.awk tests/t.py")),
                denied(bash(".venv/bin/ruff check --fix tests")),
                denied(bash(".venv/bin/ruff format tests")),
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
