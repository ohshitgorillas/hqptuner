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
CHANGE_LIMIT = budget.CHANGE_LIMIT
EDIT_LIMIT = budget.EDIT_LIMIT


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

    mid = [_said("do it"), *_ran(3), _said("<command-name>/clear</command-name>"), *_ran(2, start=3)]
    ok.append(_check("a command row mid-burst does not reset the count", bool(_verdict(mid))))
    ok.append(_check("prose mid-burst does reset the count",
                     _verdict([_said("do it"), *_ran(limit + 1), _said("now do this other thing")]) is None))

    after = [_said("do it"), *_ran(limit + 1),
             _tripped(f"{limit + 1} metered actions since the user last spoke (change budget {limit})."),
             _said("<command-name>/clear</command-name>")]
    ok.append(_check("a command row right after a trip does reset", _verdict(after) is None))

    edits = [_said("edit them")]
    for i in range(EDIT_LIMIT):
        edits += [_call(f"e{i}", f"u{i}", "Edit", {"file_path": __file__}), _done(f"u{i}")]
    data = {"cwd": os.path.dirname(os.path.abspath(__file__)),
            "tool_name": "Edit", "tool_input": {"file_path": __file__}}
    ok.append(_check(f"{EDIT_LIMIT} complete edits allowed, {EDIT_LIMIT + 1} denied",
                     bool(evaluate(data, edits)) and evaluate(data, edits[:-2]) is None))
    return ok


# (command, expected free?) — the allowlist cases worth pinning
ALLOWLIST_CASES = [
    ("sed -n '1,5p' x", True),
    ("cd /tmp && ls", False),
    # git: read-only history archaeology is investigation, not mutation
    ("git -C /srv/hqptuner log --oneline -20", True),
    ("git log --all --oneline -S 'title' -- a/b.js | head", True),
    ("git show ec903fc --stat ; git status", True),
    ("git -c core.pager=cat log", False),        # -c can define an alias
    ("git config --global user.name x", False),
    ("git commit -m x", False),
    ("git branch -d dev", False),
    ("git diff --output=/srv/hqptuner/x", False),
    # node: the JS suite, narrowed to one file
    ("node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/a.test.js", True),
    ("node -e 'require(\"fs\").rmSync(\"x\")'", False),
    ("node scripts/build.js", False),
    # pair.sh: listing the open /tests worktree pairs reads, the rest moves branches
    ("scripts/pair.sh list", True),
    ("scripts/pair.sh open eqfix", False),
    ("scripts/pair.sh merge eqfix", False),
    ("scripts/pair.sh abort eqfix", False),
    ("bash scripts/pair.sh list", False),        # `bash` is not a recognised head
    # unchanged: a shell loop is not parsed, so it still meters
    ("for f in a b; do diff -q $f x/$f; done", False),
]


def _allowlist_checks():
    return [_check(f"{'free' if want else 'meters'}: {cmd}", is_free_bash(cmd) is want)
            for cmd, want in ALLOWLIST_CASES]


def self_test():
    ok = _budget_checks() + _allowlist_checks()
    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test())
