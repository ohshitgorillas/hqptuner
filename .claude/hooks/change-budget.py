#!/usr/bin/env python3
"""change-budget — PreToolUse hook.

Caps how much an agent may change between turns where the *user* actually
speaks, then forces it to stop and report in words. A genuine human reply
resets the counters, so the agent may continue after surfacing — it just
can't run a long silent burst the user has to interrupt to stop.

Enforcement is self-tripping: the counters are the tripwire, not the user.

ONE LEASH — CHANGE_LIMIT, counting metered actions: anything that escapes the
working tree or can't be undone from it. sudo, docker, git commit/push,
mutating curl, rm, `python -c` / `python script.py`, writes outside the repo.
These are the ones the user cannot cheaply take back, so they are the ones
priced.

In-tree Write/Edit/NotebookEdit classify as EDIT and are never denied:
recoverable by `git restore`, visible in `git diff`, gated by `make check`, and
ruled on by the plan gate before they are written, which is where a runaway
edit burst actually gets caught. The class survives because the analyzers under
scripts/budget/ measure edits per leash period through it; only the limit is gone.

Deliberate asymmetry: Bash mutations always meter, even in-tree. Whether a
shell string only touches the working tree is not tractable; a structured
tool's target is a known field. So the reviewable path (nine Edit calls) is
priced below the opaque one (one `python -c` rewriting nine files).

WHAT COUNTS AS THE USER SPEAKING. Only prose the user typed — see
is_genuine_reply(). A slash command, a /clear, a task notification or a local
command's stdout is the harness talking to itself and buys nothing. One
exception, window(): the first human row after one of this hook's own denials
always resets, so answering a trip with a slash command cannot wedge the session.

WHAT COUNTS AS THIS CALL. The pending call's assistant row is usually NOT in
the transcript yet when PreToolUse fires; _pending_present() finds it if it is
and it is counted exactly once either way, so the count is its ordinal.

Free (never counted, never blocked):
  - the read-only tools in FREE_TOOLS (Read/Grep/Glob/WebFetch/WebSearch)
  - Bash calls that are purely read-only — grounding, not mutation. The
    allowlist and its parser live in free_bash.py; see that file for the rules.
  - spawns of the read-only agent types and of the project's own chain agents
    (READ_ONLY_AGENTS, FREE_SPAWN_AGENTS), and messages to a running agent
    (HARNESS_TOOLS): the recipient's own calls are metered in its context.
"""
import os
import sys
import json
import re
import importlib.util

CHANGE_LIMIT = 8   # metered actions since the user last spoke; the next blocks
# read-only tools, plus the harness's own bookkeeping: none of these reach the
# filesystem, the daemon or another agent. AskUserQuestion is how a trip gets
# answered, so pricing it would make the escape cost an action.
FREE_TOOLS = {"Read", "Grep", "Glob", "WebFetch", "WebSearch",
              "ToolSearch", "ListAgents", "TaskOutput", "AskUserQuestion",
              "EnterPlanMode", "ExitPlanMode"}

# structured edit tools -> the input field naming their target path
EDIT_TOOLS = {"Write": "file_path", "Edit": "file_path",
              "NotebookEdit": "notebook_path"}

# Agent types that cannot write. Exact names only, never a pattern: the hook
# can't see the agent registry, so a guessed name is an unmetered write.
READ_ONLY_AGENTS = {"Explore", "Plan", "caveman:cavecrew-investigator"}

# Agent types whose *spawn* is free even though they may write: the project's
# own chain agents, writer and reviewers. Their tool calls are metered by these
# same hooks in the subagent's context, so charging the spawn double-counts and
# trips the leash mid-chain. Unmeters no write. Exact names only, as above.
FREE_SPAWN_AGENTS = {"test-writer", "spec-reviewer", "plan-reviewer",
                     "user-reviewer", "abuser-reviewer", "pedant-reviewer"}

# Harness tools that move text or control between agents already running. They
# do reach an agent, so not FREE_TOOLS; free on the FREE_SPAWN_AGENTS reasoning:
# the recipient's response is metered in its own context, the message is not.
HARNESS_TOOLS = {"SendMessage", "Skill", "Monitor", "TaskStop"}


def _load(name):
    """Import a sibling hook module by path.

    Not a plain `import`: this file is itself imported by path (by
    read-volume.py, and by scripts/budget_common.py so the analyzers measure the
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
reason_metered = _free.reason_metered
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
        "command-name", "command-message", "command-args", "command-contents",
        "task-notification")
HOOK_CONTEXT = re.compile(r"^.*hook additional context:.*$", re.M)


def clean_reply(text):
    """Strip the harness wrappers, leaving what the user actually typed.

    Shared with scripts/budget_miner.py, which imports it from here — the
    analyzer and the hook must agree on what counts as the user speaking, or
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
    normalizes `..`, so an escape hatch like repo/../etc/x lands outside and
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
    unrecognized is a CHANGE — the bias stays toward metering."""
    tool_input = tool_input or {}
    if name in FREE_TOOLS or name in HARNESS_TOOLS:
        return FREE
    if name == "Agent":
        # delegating a read-only search costs the user less than running it
        # inline, so the budget must not tax it; the /tests agents are free for
        # the double-counting reason at FREE_SPAWN_AGENTS
        agent = tool_input.get("subagent_type")
        return FREE if agent in READ_ONLY_AGENTS or agent in FREE_SPAWN_AGENTS else CHANGE
    if name == "Bash":
        return FREE if is_free_bash(tool_input.get("command", "")) else CHANGE
    if name in EDIT_TOOLS:
        return EDIT if _in_tree(tool_input.get(EDIT_TOOLS[name]), root, cwd) else CHANGE
    return CHANGE


def _label(b):
    """A short quotable name for one metered call, so a denial can say WHICH
    call it charged; a bare count leaves the agent guessing which stage of a
    chained command was the metered one."""
    inp = b.get("input") or {}
    detail = str(inp.get("command") or inp.get("file_path")
                 or inp.get("subagent_type") or "")
    detail = " ".join(detail.split())[:70]
    return f"{b.get('name')}({detail})" if detail else str(b.get("name"))


def count_blocks(ev, root, cwd, labels=None):
    """(changes, edits) contributed by one transcript row. `labels`, when given,
    collects _label() for every CHANGE-class block seen."""
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
            if labels is not None:
                labels.append(_label(b))
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

    if kind == EDIT:            # in-tree, reviewable, `git restore`-able: free
        return None

    win = window(rows)
    changes, labels = 0, []
    for ev in win:
        changes += count_blocks(ev, root, cwd, labels)[0]
    if not _pending_present(win, _result_ids(rows), name, tool_input):
        changes += 1
        labels.append(_label({"name": name, "input": tool_input}))

    # Counts now include the pending call exactly once, so they are its ordinal:
    # the Nth action since the reset. N > LIMIT is the first one past budget,
    # which leaves LIMIT complete actions behind it.
    if changes > CHANGE_LIMIT:
        listing = "; ".join(labels[-(CHANGE_LIMIT + 1):])
        return (f"{changes} metered actions since the user last spoke "
                f"(change budget {CHANGE_LIMIT}). " + _REPORT
                + f"\nMetered: {listing}")
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
    if classify(data.get("tool_name"), data.get("tool_input"),
                _repo_root(cwd), cwd) in (FREE, EDIT):
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


if __name__ == "__main__":
    # fixtures live in budget_selftest.py; this file stays under the length gate
    sys.exit(_load("budget_selftest").self_test()) if "--self-test" in sys.argv else main()
