#!/usr/bin/env python3
"""change-budget — PreToolUse hook.

Caps how much an agent may change between turns where the *user* actually
speaks, then forces it to stop and report in words. A genuine human reply
resets the counters, so the agent may continue after surfacing — it just
can't run a long silent burst the user has to interrupt to stop.

Enforcement is self-tripping: it does NOT depend on the user noticing the
spam and interrupting. The counters are the tripwire.

TWO LEASHES, because reversibility differs and the old single counter priced
them identically:

  * CHANGE_LIMIT (metered actions) — anything that escapes the working tree or
    can't be undone from it: sudo, docker, git commit/push, mutating curl, rm,
    `python -c` / `python script.py`, writes outside the repo. Small budget:
    these are the ones the user cannot cheaply take back.

  * EDIT_LIMIT (structured edits) — Write/Edit/NotebookEdit to a path inside
    the current git working tree. Recoverable by `git restore`, visible in
    `git diff`, gated by `make check`, and reviewed before commit. Generous
    budget: enough to land a real change in one turn.

Whichever trips first forces the report.

Deliberate asymmetry: Bash mutations always meter, even in-tree. Deciding
whether a shell command only touches the working tree is not tractable —
is_free_bash() is already a conservative parser and will not be extended that
far. Only the structured tools get the cheap lane, because their target is a
known field rather than a string to parse. That asymmetry is a feature: it
prices the reviewable path (nine Edit calls) below the opaque one (one
`python -c` that rewrites nine files), which is the opposite of what a single
flat counter does.

WHAT COUNTS AS THE USER SPEAKING. Only prose the user typed — see
is_genuine_reply(). A slash command, a /clear, or a local command's stdout is
the harness talking to itself; measured over 135 transcripts, half of all leash
periods were opened by a row like that rather than by the user reading
anything, and each one silently bought another five actions. One exception,
window(): the first human row after one of this hook's own denials always
resets, so answering a trip with a slash command cannot wedge the session.

WHAT COUNTS AS THIS CALL. The pending call's assistant row is usually NOT in
the transcript yet when PreToolUse fires — it had not been flushed in 37 of 46
recorded trips — so counting whatever the file holds allowed one action past
the limit. _pending_present() finds it if it is there and counts it exactly
once either way, which makes the counts the pending call's ordinal.

Free (never counted, never blocked):
  - the read-only tools in FREE_TOOLS (Read/Grep/Glob/WebFetch/WebSearch)
  - Bash calls that are purely read-only — grounding, not mutation. The
    allowlist and its parser live in free_bash.py; see that file for the rules.
"""
import os
import sys
import json
import re
import importlib.util

CHANGE_LIMIT = 5   # metered actions since the user last spoke; the next blocks
# Measured over 135 transcripts: the change leash caught real drift 52.9% of the
# time, the edit leash 11.1% — eight of its nine trips were the user saying
# "continue" to work that was going fine. The edit allowance was interrupting
# rather than catching, so it doubled; the change budget earned its number.
EDIT_LIMIT = 30    # in-tree structured edits since the user last spoke
FREE_TOOLS = {"Read", "Grep", "Glob", "WebFetch", "WebSearch"}  # read-only tools

# structured edit tools -> the input field naming their target path
EDIT_TOOLS = {"Write": "file_path", "Edit": "file_path",
              "NotebookEdit": "notebook_path"}

# Agent types that cannot write. Exact names only, never a pattern: the hook
# can't see the agent registry, so a guessed name is an unmetered write.
READ_ONLY_AGENTS = {"Explore", "Plan", "caveman:cavecrew-investigator"}


def _load(name):
    """Import a sibling hook module by path.

    Not a plain `import`: this file is itself imported by path (by
    read-volume.py, and by scripts/budget_common.py so the analysers measure the
    rule that actually runs), and in those processes the hook directory is not
    on sys.path.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_free = _load("free_bash")
# re-exported: the callers above reach for these through this module, which is
# the one they load
is_free_bash = _free.is_free_bash
_curl_ok = _free._curl_ok
_strip_prefix = _free._strip_prefix
_cmd_name = _free._cmd_name
READERS = _free.READERS


# ---- transcript accounting --------------------------------------------------

def _msg(ev):
    # transcript rows wrap the API message under "message"; fall back to row
    m = ev.get("message")
    return m if isinstance(m, dict) else ev


def is_human_row(ev):
    """True for any user-role row that is not a tool_result. Includes the rows
    the harness manufactures: slash commands, /clear, injected local-command
    output. A row, not necessarily a turn — see is_genuine_reply()."""
    m = _msg(ev)
    if m.get("role") != "user":
        return False
    content = m.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        # a tool_result carries tool_result blocks; a human turn does not
        return not any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in content
        )
    return False


# Wrappers the harness puts around, or instead of, what the user typed. A row
# made only of these is the harness talking to itself, not the user speaking.
TAGS = ("system-reminder", "local-command-caveat", "local-command-stdout",
        "command-name", "command-message", "command-args", "command-contents")
HOOK_CONTEXT = re.compile(r"^.*hook additional context:.*$", re.M)


def clean_reply(text):
    """Strip the harness wrappers, leaving what the user actually typed.

    Shared with scripts/budget_miner.py, which imports it from here — the
    analyser and the hook must agree on what counts as the user speaking, or
    the measurements describe a different rule than the one enforced.
    """
    for tag in TAGS:
        text = re.sub(rf"<{tag}>.*?</{tag}>", " ", text, flags=re.S)
        text = re.sub(rf"</?{tag}>", " ", text)
    return HOOK_CONTEXT.sub(" ", text).strip()


def _row_text(ev):
    m = _msg(ev)
    content = m.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return ""


def is_genuine_reply(ev):
    """True only when a human row carries prose the user typed.

    The budget exists to make the agent surface its work *in words the user
    reads*. A /clear, a slash command, or a local command's stdout is not the
    user reading anything, so it must not buy another five actions.
    """
    if not is_human_row(ev):
        return False
    text = clean_reply(_row_text(ev))
    return bool(text) and not text.startswith("/")


BUDGET_SIGS = ("metered actions since the user last spoke",
               "in-tree edits since the user last spoke")


def is_budget_denial(ev):
    """True for a row recording one of this hook's own denials."""
    if ev.get("toolDenialKind") != "permission-rule":
        return False
    content = _msg(ev).get("content")
    if not isinstance(content, list):
        return False
    for b in content:
        if not isinstance(b, dict) or b.get("type") != "tool_result":
            continue
        text = b.get("content")
        if isinstance(text, str) and any(s in text for s in BUDGET_SIGS):
            return True
    return False


FREE, EDIT, CHANGE = "free", "edit", "change"


def _repo_root(start):
    """Nearest enclosing git working tree of `start`, or None. `.git` is a dir
    in a normal clone and a file in a submodule/worktree — accept either."""
    d = os.path.abspath(start or ".")
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def _in_tree(path, root, cwd):
    """True when `path` resolves inside the working tree at `root`. abspath
    normalises `..`, so an escape hatch like repo/../etc/x lands outside and
    meters."""
    if not root or not path:
        return False
    p = os.path.abspath(os.path.join(cwd or root, path))
    try:
        return os.path.commonpath([p, root]) == root
    except ValueError:
        return False  # unrelated roots -> not in tree -> meters


def classify(name, tool_input, root, cwd):
    """Which leash a tool call pulls: FREE, EDIT, or CHANGE. Anything
    unrecognised is a CHANGE — the bias stays toward metering."""
    tool_input = tool_input or {}
    if name in FREE_TOOLS:
        return FREE
    if name == "Agent":
        # delegating a read-only search costs the user less than running it
        # inline, so the budget must not tax it
        return FREE if tool_input.get("subagent_type") in READ_ONLY_AGENTS else CHANGE
    if name == "Bash":
        return FREE if is_free_bash(tool_input.get("command", "")) else CHANGE
    if name in EDIT_TOOLS:
        return EDIT if _in_tree(tool_input.get(EDIT_TOOLS[name]), root, cwd) else CHANGE
    return CHANGE


def count_blocks(ev, root, cwd):
    """(changes, edits) contributed by one transcript row."""
    m = _msg(ev)
    if m.get("role") != "assistant":
        return 0, 0
    content = m.get("content")
    if not isinstance(content, list):
        return 0, 0
    changes = edits = 0
    for b in content:
        if not isinstance(b, dict) or b.get("type") != "tool_use":
            continue
        kind = classify(b.get("name"), b.get("input"), root, cwd)
        if kind == CHANGE:
            changes += 1
        elif kind == EDIT:
            edits += 1
    return changes, edits


def window(rows):
    """The rows since the last reset, oldest first.

    Two ways a reset happens, and only two:

      * the user speaks — is_genuine_reply(); or
      * the first human row after one of this hook's own denials, whatever that
        row is. Without this a user who answers a trip with a slash command
        would stay wedged at the limit with no way to clear it except typing
        prose, which is a trap rather than a budget.
    """
    escape = None
    for i in range(len(rows) - 1, -1, -1):
        ev = rows[i]
        if is_human_row(ev):
            if is_genuine_reply(ev):
                return rows[i + 1:]
            escape = i + 1          # candidate: a post-trip escape hatch
        elif escape is not None and is_budget_denial(ev):
            return rows[escape:]
    return rows


def _result_ids(rows):
    """Every tool_use_id that already has a result — i.e. has finished."""
    ids = set()
    for ev in rows:
        content = _msg(ev).get("content")
        if not isinstance(content, list):
            continue
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id"):
                ids.add(b["tool_use_id"])
    return ids


def _pending_present(rows, done, name, tool_input):
    """True when the call PreToolUse is asking about is already in the transcript.

    It usually is not, so counting only what the file holds silently allowed one
    action past the limit. Identify the pending call as the one matching
    (name, input) with no result yet, and count it exactly once either way.
    """
    for ev in rows:
        m = _msg(ev)
        if m.get("role") != "assistant" or not isinstance(m.get("content"), list):
            continue
        for b in m["content"]:
            if (isinstance(b, dict) and b.get("type") == "tool_use"
                    and b.get("name") == name
                    and (b.get("input") or {}) == (tool_input or {})
                    and b.get("id") not in done):
                return True
    return False


_REPORT = ("Stop now and report in plain words: what you did, what you found, "
           "what you plan next. Do not run another command until you've "
           "surfaced this. A reply where the user speaks resets both budgets.")


def evaluate(data, rows):
    """The denial reason for this pending call, or None to allow it."""
    cwd = data.get("cwd") or os.getcwd()
    root = _repo_root(cwd)
    name, tool_input = data.get("tool_name"), data.get("tool_input")

    kind = classify(name, tool_input, root, cwd)
    if kind == FREE:            # costs nothing: allow regardless of prior counts
        return None

    win = window(rows)
    changes = edits = 0
    for ev in win:
        c, e = count_blocks(ev, root, cwd)
        changes += c
        edits += e
    if not _pending_present(win, _result_ids(rows), name, tool_input):
        changes += kind == CHANGE
        edits += kind == EDIT

    # Counts now include the pending call exactly once, so they are its ordinal:
    # the Nth action since the reset. N > LIMIT is the first one past budget,
    # which leaves LIMIT complete actions behind it.
    if changes > CHANGE_LIMIT:
        return (f"{changes} metered actions since the user last spoke "
                f"(change budget {CHANGE_LIMIT}). " + _REPORT)
    if edits > EDIT_LIMIT:
        return (f"{edits} in-tree edits since the user last spoke "
                f"(edit allowance {EDIT_LIMIT}). " + _REPORT)
    return None


def _rows(path):
    with open(path) as f:
        lines = f.read().splitlines()
    rows = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return  # never block on our own failure

    # Cheap exit before touching the transcript: a free call can never be
    # denied, and parsing a multi-megabyte file to learn that would put the
    # cost of the budget on the calls the budget deliberately does not price.
    cwd = data.get("cwd") or os.getcwd()
    if classify(data.get("tool_name"), data.get("tool_input"), _repo_root(cwd), cwd) == FREE:
        return

    tp = data.get("transcript_path")
    if not tp:
        return
    try:
        rows = _rows(tp)
    except Exception:
        return

    reason = evaluate(data, rows)
    if not reason:
        return

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


# ---- self-test --------------------------------------------------------------


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


def self_test():
    limit = CHANGE_LIMIT
    ok = [_check(f"action {limit} allowed with {limit - 1} complete",
                 _verdict([_said("do it"), *_ran(limit - 1)]) is None)]
    reason = _verdict([_said("do it"), *_ran(limit)])
    ok.append(_check(f"action {limit + 1} denied with {limit} complete", bool(reason)))
    ok.append(_check("denied count is the pending call's ordinal",
                     reason.startswith(f"{limit + 1} metered actions")))
    flushed = _verdict([_said("do it"), *_ran(limit), _call("z", "tz", "Bash", {"command": "sudo pending"})])
    ok.append(_check("same verdict when the pending row is already flushed",
                     flushed == reason))
    ok.append(_check("a free call is never denied",
                     _verdict([_said("hi"), *_ran(limit + 5)], "ls -la") is None))

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

    ok.append(_check("the bash allowlist still loads and still discriminates",
                     is_free_bash("sed -n '1,5p' x") and not is_free_bash("cd /tmp && ls")))

    print(f"\n{sum(ok)}/{len(ok)} passed")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(self_test()) if "--self-test" in sys.argv else main()
