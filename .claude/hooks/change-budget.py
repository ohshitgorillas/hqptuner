#!/usr/bin/env python3
"""
change-budget — PreToolUse hook.

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

Free (never counted, never blocked):
  - the read-only tools in FREE_TOOLS (Read/Grep/Glob/WebFetch/WebSearch)
  - Bash calls that are purely read-only — grounding, not mutation. Two
    flavours, see is_free_bash():
      * verification: `make check`, `pytest`, `ruff check`, `mypy`, …
      * investigation: `grep`, `sed -n`, `ls`, `find`, `cat`, `head`, … and
        `pdftotext` to stdout or the scratchpad.
    A command qualifies only when EVERY &&/;-segment and EVERY pipe-stage is a
    recognised read-only command, output goes only to /dev/null / an fd-dup /
    the session scratchpad, and there is no subshell, backtick, chained
    mutator, or file-writing flag. Operator detection is quote-aware: a `>` or
    `|` inside a quoted argument (e.g. `grep -o '<m [^>]*'`) is data, not a
    redirect. Any doubt -> it meters. A false-meter costs one report; a
    false-free would let a mutation slip past the budget, so the bias is
    always toward metering.
"""
import os
import sys
import json
import re
import shlex

CHANGE_LIMIT = 5   # metered actions since the user last spoke; the next blocks
EDIT_LIMIT = 15    # in-tree structured edits since the user last spoke
FREE_TOOLS = {"Read", "Grep", "Glob", "WebFetch", "WebSearch"}  # read-only tools

# structured edit tools -> the input field naming their target path
EDIT_TOOLS = {"Write": "file_path", "Edit": "file_path",
              "NotebookEdit": "notebook_path"}

# Agent types that cannot write. Exact names only, never a pattern: the hook
# can't see the agent registry, so a guessed name is an unmetered write.
READ_ONLY_AGENTS = {"Explore", "Plan", "caveman:cavecrew-investigator"}

# ---- read-only Bash allowlist (verification + investigation) ----------------

# verifiers — meaningful only as a pipeline head.
# lint-js / test-js / check-css are this repo's JS-side gates (make check =
# lint lint-js test test-js); they verify and mutate nothing.
FREE_MAKE_TARGETS = {"check", "test", "test-live", "lint", "typecheck",
                     "fmt-check", "format-check",
                     "lint-js", "test-js", "check-css"}
FREE_PY_CMDS = {"pytest", "py.test", "unittest", "mypy", "xenon", "flake8", "pyright", "pylint"}
# readers — read-only text tools, valid as a pipe head OR a downstream stage.
# sed / find / sort are read-only only with restrictions, handled specially.
READERS = {"grep", "egrep", "fgrep", "rg", "ls", "cat", "head", "tail", "wc",
           "stat", "file", "diff", "comm", "cut", "uniq", "nl", "column",
           "tr", "fold", "rev", "tac", "less", "more", "jq", "which", "whereis",
           "echo", "printf"}
# rpm/dpkg mutating flags — presence disqualifies the query
RPM_BAD = {"-i", "-U", "-F", "-e", "--install", "--upgrade", "--freshen",
           "--erase", "--import", "--rebuilddb", "--setperms", "--setugids"}
# `find` actions that execute or mutate
FIND_BAD = {"-exec", "-execdir", "-delete", "-ok", "-okdir",
            "-fprint", "-fprint0", "-fprintf", "-fls"}

# substrings that can never appear benignly OUTSIDE quotes in a read-only command
BANNED_SUBSTR = ("`", "$(", "<(", ">(", "||", "--fix", "--write", "--in-place",
                 "--output")

_REDIR_OP = re.compile(r'(\d*)(&>>|&>|>>|>&|>)')      # optional fd + output op
_BG_AMP = re.compile(r'(?<![>&])&(?![&>])')            # a lone background &


def _cmd_name(tok):
    return tok.rsplit("/", 1)[-1]  # strip path: .venv/bin/pytest -> pytest


def _is_scratch(p):
    """A path under a session scratchpad dir (/tmp/claude-*/…/scratchpad/…)."""
    return ".." not in p and bool(
        re.match(r'/tmp/claude[^/]*/.+/scratchpad(?:/|$)', p)
    )


def _redir_target_ok(t):
    return t == "/dev/null" or _is_scratch(t)


def _mask(s):
    """Replace the interior of every quoted span with 'x', preserving length and
    all unquoted characters. Lets operator/redirect detection ignore quoted
    data. Returns None on an unbalanced quote."""
    res, q = [], None
    for c in s:
        if q:
            res.append(c if c == q else "x")
            if c == q:
                q = None
        elif c in ("'", '"'):
            q = c
            res.append(c)
        else:
            res.append(c)
    return None if q is not None else "".join(res)


def _split(masked, orig, pattern):
    """Split orig at the positions where pattern matches in masked (same length).
    Returns a list of (masked_part, orig_part)."""
    parts, last = [], 0
    for m in re.finditer(pattern, masked):
        parts.append((masked[last:m.start()], orig[last:m.start()]))
        last = m.end()
    parts.append((masked[last:], orig[last:]))
    return parts


def _read_word(s, i):
    """Read one shell word from s starting at i (skipping leading blanks),
    respecting quotes. Returns (unquoted_value, end_index)."""
    n = len(s)
    while i < n and s[i] in " \t":
        i += 1
    val, q = [], None
    while i < n:
        c = s[i]
        if q:
            if c == q:
                q = None
            else:
                val.append(c)
        elif c in ("'", '"'):
            q = c
        elif c in " \t|;&<>":
            break
        else:
            val.append(c)
        i += 1
    return "".join(val), i


def _strip_prefix(toks):
    """Drop leading env assignments and a runner prefix (uv run / poetry run / npx)."""
    i = 0
    while i < len(toks) and re.match(r'^[A-Za-z_]\w*=', toks[i]):
        i += 1
    if i < len(toks):
        if toks[i] in ("uv", "poetry") and i + 1 < len(toks) and toks[i + 1] == "run":
            i += 2
        elif toks[i] == "npx":
            i += 1
    # `python -m <module>` — expose the module (pytest, mypy, …) to the allowlist;
    # a non-verifier module (pip, http.server) still fails it and meters.
    if (i + 2 < len(toks) and re.match(r'^python[0-9.]*$', _cmd_name(toks[i]))
            and toks[i + 1] == "-m"):
        i += 2
    return toks[i:]


def _analyze_redirects(mstage, ostage):
    """Validate every output redirect targets only /dev/null, an fd-dup, or the
    scratchpad, and reject a background `&`. Returns ostage with the redirect
    tokens removed (ready for shlex), or None if anything is unsafe."""
    if _BG_AMP.search(mstage):
        return None
    spans = []
    for m in _REDIR_OP.finditer(mstage):
        op = m.group(2)
        tgt, wend = _read_word(ostage, m.end())
        if op == ">&" and (tgt == "-" or tgt.isdigit()):
            spans.append((m.start(), wend))          # fd dup, no file
            continue
        if not tgt or not _redir_target_ok(tgt):
            return None
        spans.append((m.start(), wend))
    clean, last = [], 0
    for a, b in sorted(spans):
        clean.append(ostage[last:a])
        last = b
    clean.append(ostage[last:])
    return "".join(clean)


def _curl_ok(rest):
    """A read-only curl: loopback URL only, GET/HEAD only, no data/upload/output
    flags. Blocks POSTs, uploads, and file-writes; a side-effecting GET to a
    local dev service is the accepted residual (can't tell read path from write
    path by URL)."""
    for a in rest:
        short = a.startswith("-") and not a.startswith("--")
        if short and a[:2] in ("-d", "-F", "-T", "-o", "-O"):
            return False
        if a.startswith(("--data", "--form", "--upload", "--output", "--remote-name")):
            return False
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ("-X", "--request"):
            m = rest[i + 1] if i + 1 < len(rest) else ""
            if m.upper() not in ("GET", "HEAD"):
                return False
            i += 2
            continue
        if a.startswith("-X") and a[2:].upper() not in ("GET", "HEAD"):
            return False
        i += 1
    urls = [a for a in rest if a.startswith(("http://", "https://"))]
    if not urls:
        return False
    loop = re.compile(
        r'^https?://(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?([/?].*)?$',
        re.I,
    )
    return all(loop.match(u) for u in urls)


def _stage_ok(mstage, ostage, is_head):
    clean = _analyze_redirects(mstage, ostage)
    if clean is None:
        return False
    try:
        toks = _strip_prefix(shlex.split(clean, comments=False, posix=True))
    except ValueError:
        return False
    if not toks:
        return False
    name = _cmd_name(toks[0])
    rest = toks[1:]

    # readers with read-only restrictions (valid head or downstream)
    if name == "sed":
        # read-only in no-autoprint mode (-n / -ne / -nE / --quiet / --silent),
        # never in-place (-i / -i.bak / bundle containing i / --in-place)
        short = [a for a in rest if a.startswith("-") and not a.startswith("--")]
        quiet = (any(a in ("--quiet", "--silent") for a in rest)
                 or any("n" in a for a in short))
        inplace = (any(a.startswith("--in-place") for a in rest)
                   or any("i" in a for a in short))
        return quiet and not inplace
    if name == "find":
        return not any(a in FIND_BAD for a in rest)
    if name == "sort":
        return not any(a == "-o" or a.startswith("-o") or a.startswith("--output")
                       for a in rest)
    if name == "rpm":
        # query mode only (-q / -ql / -qa / --query); never install/erase/etc.
        qmode = any(a.startswith("-q") or a == "--query" for a in rest)
        return qmode and not any(a in RPM_BAD for a in rest)
    if name == "command":
        return "-v" in rest or "-V" in rest      # locate only, never exec
    if name == "curl":
        return _curl_ok(rest)                     # loopback GET only
    if name in ("pip", "pip3"):
        # read-only query subcommands only; install/uninstall/download/config mutate
        sub = next((a for a in rest if not a.startswith("-")), None)
        return sub in {"list", "show", "freeze", "check", "inspect"}
    if name in READERS:
        return True

    if not is_head:
        return False

    # head-only sources / verifiers
    if name == "make":
        targets = [a for a in rest if not a.startswith("-")]
        return bool(targets) and all(t in FREE_MAKE_TARGETS for t in targets)
    if name == "ruff":
        return bool(rest) and rest[0] == "check"      # `ruff format` mutates
    if name == "black":
        return "--check" in rest                      # bare black reformats
    if name == "pdftotext":
        # output must be stdout (`-`) or a scratchpad file; never a repo path
        pos = [a for a in rest if a == "-" or not a.startswith("-")]
        return bool(pos) and (pos[-1] == "-" or _is_scratch(pos[-1]))
    if name in FREE_PY_CMDS:
        return True
    return False


def _seg_ok(mseg, oseg):
    stages = _split(mseg, oseg, r'\|')     # || is banned earlier, so | is a pipe
    if any(not o.strip() for _, o in stages):
        return False
    if not _stage_ok(stages[0][0], stages[0][1], True):
        return False
    return all(_stage_ok(m, o, False) for m, o in stages[1:])


def is_free_bash(cmd):
    """True only for a purely read-only command (verification or investigation).
    Bias: any doubt returns False (the command meters)."""
    try:
        if not cmd or not cmd.strip():
            return False
        masked = _mask(cmd)
        if masked is None:
            return False
        for b in BANNED_SUBSTR:
            if b in masked:
                return False
        segs = [(m, o) for m, o in _split(masked, cmd, r'&&|;') if o.strip()]
        if not segs:
            return False
        return all(_seg_ok(m, o) for m, o in segs)
    except Exception:
        return False  # parse failure -> not free -> meters (safe side)


# ---- transcript accounting --------------------------------------------------

def _msg(ev):
    # transcript rows wrap the API message under "message"; fall back to row
    m = ev.get("message")
    return m if isinstance(m, dict) else ev


def is_human_turn(ev):
    """True only for a real user message — NOT a tool_result (which the
    transcript also records with role=user)."""
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


_REPORT = ("Stop now and report in plain words: what you did, what you found, "
           "what you plan next. Do not run another command until you've "
           "surfaced this. A reply where the user speaks resets both budgets.")


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return  # never block on our own failure

    cwd = data.get("cwd") or os.getcwd()
    root = _repo_root(cwd)

    # pending call that costs nothing: allow regardless of prior counts
    if classify(data.get("tool_name"), data.get("tool_input"), root, cwd) == FREE:
        return

    tp = data.get("transcript_path")
    if not tp:
        return
    try:
        with open(tp) as f:
            lines = f.read().splitlines()
    except Exception:
        return

    changes = edits = 0
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if is_human_turn(ev):
            break
        c, e = count_blocks(ev, root, cwd)
        changes += c
        edits += e

    # Both counts include the pending call (its assistant message is already in
    # the transcript when PreToolUse fires), so count == LIMIT+1 is the first
    # call past that budget.
    if changes > CHANGE_LIMIT:
        reason = (f"{changes} metered actions since the user last spoke "
                  f"(change budget {CHANGE_LIMIT}). " + _REPORT)
    elif edits > EDIT_LIMIT:
        reason = (f"{edits} in-tree edits since the user last spoke "
                  f"(edit allowance {EDIT_LIMIT}). " + _REPORT)
    else:
        return

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


if __name__ == "__main__":
    main()
