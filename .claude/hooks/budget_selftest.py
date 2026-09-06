#!/usr/bin/env python3
"""Self-test for change-budget.py — `python3 .claude/hooks/budget_selftest.py`,
or `change-budget.py --self-test`, which delegates here.

The budget's own file
has to stay under the repo's 500-line gate, and the fixtures are the part with
no policy in them.
"""
import os
import sys
import importlib.util


def _load(name):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


budget = _load("change-budget")
evaluate = budget.evaluate
is_free_bash = budget.is_free_bash
reason_metered = budget.reason_metered
CHANGE_LIMIT = budget.CHANGE_LIMIT


def _call(uuid, tool_id, name, tool_input):
    content = [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}]
    return {"uuid": uuid, "message": {"role": "assistant", "content": content}}


def _done(tool_id):
    block = {"type": "tool_result", "tool_use_id": tool_id, "content": "ok"}
    return {"message": {"role": "user", "content": [block]}}


def _said(text):
    return {"message": {"role": "user", "content": text}}


def _tripped(text):
    block = {"type": "tool_result", "is_error": True, "tool_use_id": "t", "content": text}
    return {"toolDenialKind": "permission-rule",
            "message": {"role": "user", "content": [block]}}


def _ran(count, command="sudo ls", start=0):
    """`count` completed metered calls, each with its result already recorded."""
    rows = []
    for i in range(start, start + count):
        rows.append(_call(f"a{i}", f"t{i}", "Bash", {"command": f"{command} {i}"}))
        rows.append(_done(f"t{i}"))
    return rows


def _verdict(rows, command="sudo pending"):
    data = {"cwd": os.path.dirname(os.path.abspath(__file__)),
            "tool_name": "Bash", "tool_input": {"command": command}}
    return evaluate(data, rows)


def _check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    return condition


def _budget_checks():
    limit = CHANGE_LIMIT
    ok = [_check(f"action {limit} allowed with {limit - 1} complete",
                 _verdict([_said("do it"), *_ran(limit - 1)]) is None)]
    reason = _verdict([_said("do it"), *_ran(limit)])
    ok.append(_check(f"action {limit + 1} denied with {limit} complete", bool(reason)))
    ok.append(_check("denied count is the pending call's ordinal",
                     reason.startswith(f"{limit + 1} metered actions")))
    ok.append(_check("the denial names the metered calls, pending one last",
                     reason.rstrip().endswith("Bash(sudo pending)")))
    ok.append(_check("the denial names one call per metered action",
                     reason.rsplit("Metered: ", 1)[1].count(";") == limit))
    flushed = _verdict([_said("do it"), *_ran(limit), _call("z", "tz", "Bash", {"command": "sudo pending"})])
    ok.append(_check("same verdict when the pending row is already flushed",
                     flushed == reason))
    ok.append(_check("a free call is never denied",
                     _verdict([_said("hi"), *_ran(limit + 5)], "ls -la") is None))

    spawn = {"cwd": os.path.dirname(os.path.abspath(__file__)), "tool_name": "Agent",
             "tool_input": {"subagent_type": "test-writer", "prompt": "spec"}}
    ok.append(_check("a /tests agent spawn is free past the limit",
                     evaluate(spawn, [_said("hi"), *_ran(limit + 5)]) is None))
    review = dict(spawn, tool_input={"subagent_type": "plan-reviewer", "prompt": "plan"})
    ok.append(_check("a plan-reviewer spawn is free past the limit",
                     evaluate(review, [_said("hi"), *_ran(limit + 5)]) is None))

    rounds = [_said("do it")]
    for i in range(limit):
        rounds += [_call(f"s{i}", f"ts{i}", "SendMessage", {"to": "r", "message": "again"}),
                   _done(f"ts{i}")]
    ok.append(_check("messages to a running agent do not count toward the limit",
                     _verdict(rounds) is None))

    note = ("<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n"
            "<result>READY</result>\n</task-notification>")
    noted = [_said("do it"), *_ran(3), _said(note), *_ran(limit - 2, start=3)]
    ok.append(_check("a task notification mid-burst does not reset the count", bool(_verdict(noted))))

    mid = [_said("do it"), *_ran(3), _said("<command-name>/clear</command-name>"),
           *_ran(limit - 2, start=3)]
    ok.append(_check("a command row mid-burst does not reset the count", bool(_verdict(mid))))
    ok.append(_check("prose mid-burst does reset the count",
                     _verdict([_said("do it"), *_ran(limit + 1), _said("now do this other thing")]) is None))

    after = [_said("do it"), *_ran(limit + 1),
             _tripped(f"{limit + 1} metered actions since the user last spoke (change budget {limit})."),
             _said("<command-name>/clear</command-name>")]
    ok.append(_check("a command row right after a trip does reset", _verdict(after) is None))

    ask = {"cwd": os.path.dirname(os.path.abspath(__file__)),
           "tool_name": "AskUserQuestion", "tool_input": {"questions": []}}
    ok.append(_check("surfacing to the user is free past the limit",
                     evaluate(ask, [_said("hi"), *_ran(limit + 5)]) is None))

    edits = [_said("edit them")]
    for i in range(500):
        edits += [_call(f"e{i}", f"u{i}", "Edit", {"file_path": __file__}), _done(f"u{i}")]
    data = {"cwd": os.path.dirname(os.path.abspath(__file__)),
            "tool_name": "Edit", "tool_input": {"file_path": __file__}}
    ok.append(_check("in-tree edits are never denied, however many",
                     evaluate(data, edits) is None))
    outside = {"cwd": os.path.dirname(os.path.abspath(__file__)),
               "tool_name": "Write", "tool_input": {"file_path": "/etc/x"}}
    ok.append(_check("a write outside the tree still meters past the limit",
                     bool(evaluate(outside, [_said("hi"), *_ran(limit)]))))
    return ok


# (command, expected free?) — and, for a metering case, a third element: a token
# the command itself contains, which the reason must echo back. The token is
# typed here in the input, so asserting on it pins which part of the command
# decided the verdict without pinning a word of the diagnostic's prose.
ALLOWLIST_CASES = [
    ("sed -n '1,5p' x", True),
    # python: a gate under scripts/gates/ by its relative path is a verifier;
    # any other script, or the same suffix somewhere else, is arbitrary code
    (".venv/bin/python scripts/gates/check_test_assertions.py tests/*.py", True),
    ("cd /srv/x/.claude/worktrees/y-spec && .venv/bin/python scripts/gates/check_no_copy_assertions.py tests/a.py", True),
    ("python scripts/other.py", False, "python"),
    ("python /tmp/x/scripts/gates/check_x.py", False, "python"),
    ("sed -E 's/x/y/' f", False, "-n"),
    ("black --diff x", False, "--check"),
    # ruff: `check` reads, `format` rewrites unless it is only reporting
    ("ruff format --check hqptuner", True),
    ("ruff format hqptuner", False, "--check"),
    # cd: a free segment head, but it frees only itself
    ("cd /tmp && ls", True),
    ("cd /tmp && sudo ls", False, "sudo"),
    ("cd /tmp; rm -rf x", False, "rm"),
    # credentials: `source` is free only for hqpcreds, never a general file
    ("set -a && source /srv/hqptuner/hqpcreds && set +a && make check", True),
    (". hqpcreds", True),
    ("source /tmp/evil.sh", False, "source"),
    # command substitution: two known-safe forms, nothing else
    ("PYTHONPATH=$(pwd) make check", True),
    ("make -C $(git rev-parse --show-toplevel) check", True),
    ("ls $(cat /etc/passwd)", False, "$("),
    # make: -C takes a directory, which is not a target
    ("make -C /srv/hqptuner/.claude/worktrees/x check", True),
    ("make -C /x mutate", False, "mutate"),
    # a segment that is only variable assignments binds names and runs nothing
    ("S=/srv/hqptuner; grep -n check $S/Makefile", True),
    ("S=x; sudo ls", False, "sudo"),
    # npx verifiers: read-only ones by name; --fix / --write are banned already
    ("npx tsc -p jsconfig.json", True),
    ("npx eslint . --fix", False, "--fix"),
    ("npx prettier --check hqptuner/static/", True),
    ("npx prettier --write hqptuner/static/", False, "--write"),
    ("npx tsc x.js", False, "tsc"),
    ("npx some-codemod", False, "some-codemod"),
    # git: read-only history archaeology is investigation, not mutation
    ("git -C /srv/hqptuner log --oneline -20", True),
    ("git log --all --oneline -S 'title' -- a/b.js | head", True),
    ("git show ec903fc --stat ; git status", True),
    ("git -c core.pager=cat log", False, "-c"),  # -c can define an alias
    ("git config --global user.name x", False, "config"),
    ("git commit -m x", False, "commit"),
    ("git branch -v", True),
    ("git branch -d dev", False, "-d"),
    ("git branch -D main", False, "-D"),
    ("git worktree list", True),
    ("git worktree remove x", False, "remove"),
    ("git check-ignore -v docs/x.md", True),
    ("git diff --output=/srv/hqptuner/x", False, "--output"),
    # node: the JS suite, narrowed to one file
    ("node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/a.test.js", True),
    ("node -e 'require(\"fs\").rmSync(\"x\")'", False, "-e"),
    ("node scripts/build.js", False, "--test"),
    # pair.sh: listing the open /tests worktree pairs reads, the rest moves branches
    ("scripts/pair.sh list", True),
    ("scripts/pair.sh open eqfix", False, "open"),
    ("scripts/pair.sh respec eqfix specs/eqfix.txt", False, "respec"),
    ("scripts/pair.sh merge eqfix", False, "merge"),
    ("scripts/pair.sh abort eqfix", False, "abort"),
    ("bash scripts/pair.sh list", False, "bash"),   # `bash` is not a recognized head
    # unchanged: a shell loop is not parsed, so it still meters
    ("for f in a b; do diff -q $f x/$f; done", False, "for"),
]


def _allowlist_checks():
    ok = [_check(f"{'free' if case[1] else 'meters'}: {case[0]}",
                 is_free_bash(case[0]) is case[1])
          for case in ALLOWLIST_CASES]
    # every metering case carries a token, so the sweep below cannot be
    # satisfied by a reason that explains only the cases someone thought of
    metering = [c for c in ALLOWLIST_CASES if not c[1]]
    ok.append(_check("every metering case declares a deciding token",
                     all(len(c) == 3 for c in metering)))
    ok += [_check(f"reason names {c[2]}: {c[0]}", c[2] in reason_metered(c[0]))
           for c in metering if len(c) == 3]
    return ok


def self_test():
    ok = _budget_checks() + _allowlist_checks()
    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test())
