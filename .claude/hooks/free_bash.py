#!/usr/bin/env python3
"""The read-only Bash allowlist — verification and investigation.

change-budget.py owns the accounting; this owns the one question "is this shell
command purely read-only?", kept apart so the budget's file stays under the gate.

A command qualifies only when EVERY &&/;-segment and EVERY pipe-stage is a
recognized read-only command, output goes only to /dev/null / an fd-dup / the
session scratchpad, and there is no subshell, backtick, chained mutator, or
file-writing flag. Operator detection is quote-aware: a `>` or `|` inside a
quoted argument (e.g. `grep -o '<m [^>]*'`) is data, not a redirect — the
masking and word splitting that buys are in free_bash_lex.py, which holds the
shape questions this file's verdicts are asked on top of.

Any doubt -> it meters. A false-meter costs one report; a false-free would let a
mutation slip past the budget, so the bias is always toward metering.
"""

import os
import re
import shlex
import sys

# Not a plain sibling import: this file is loaded by path (change-budget.py,
# md-by-tool.py), and in those processes the hook directory is not on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import free_bash_lex as lex  # noqa: E402
from free_bash_tables import (  # noqa: E402
    FIND_BAD,
    FREE_JS_CMDS,
    FREE_MAKE_TARGETS,
    FREE_PY_CMDS,
    GATE_SCRIPT,
    GIT_BRANCH_BAD,
    GIT_GLOBAL_FLAGS,
    GIT_READ_SUBCMDS,
    NODE_BAD,
    READERS,
    RPM_BAD,
    SET_FLAGS,
    SOURCEABLE,
)


def _cmd_name(tok):
    return tok.rsplit("/", 1)[-1]  # strip path: .venv/bin/pytest -> pytest


def _no(note, reason):
    """Record why this command meters, then reject it. Every reason echoes a
    token from the command itself, so read-volume.py's counter can name it."""
    if note is not None and not note:
        note.append(reason)
    return False


def _strip_prefix(toks):
    """Drop leading env assignments and a runner prefix (uv run / poetry run / npx)."""
    i = 0
    while i < len(toks) and re.match(r"^[A-Za-z_]\w*=", toks[i]):
        i += 1
    if i < len(toks):
        if toks[i] in ("uv", "poetry") and i + 1 < len(toks) and toks[i + 1] == "run":
            i += 2
        elif toks[i] == "npx":
            i += 1
    # `python -m <module>` — expose the module (pytest, mypy, …) to the allowlist;
    # a non-verifier module (pip, http.server) still fails it and meters.
    if i + 2 < len(toks) and re.match(r"^python[0-9.]*$", _cmd_name(toks[i])) and toks[i + 1] == "-m":
        i += 2
    return toks[i:]


def _curl_ok(rest):
    """A read-only curl: loopback URL, GET/HEAD, no data/upload/output flags.
    A side-effecting GET to a local dev service is the accepted residual."""
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
        r"^https?://(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?([/?].*)?$",
        re.I,
    )
    return all(loop.match(u) for u in urls)


def _git_ok(rest, note=None):
    """A read-only git: a query subcommand, reached through only the global
    options above. History archaeology is investigation, not mutation."""
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "-C":
            i += 2  # -C <path>
        elif a in GIT_GLOBAL_FLAGS or a.startswith(("--git-dir=", "--work-tree=")):
            i += 1
        else:
            break
    if i >= len(rest):
        return _no(note, "`git` with no subcommand")
    sub, args = rest[i], rest[i + 1 :]
    if sub == "worktree":
        if args and args[0] == "list":  # add/remove move trees
            return True
        return _no(note, f"`git worktree {args[0] if args else ''}`")
    if sub == "branch":
        bad = next((a for a in args if a in GIT_BRANCH_BAD or a.startswith("--set-upstream-to=")), None)
        return True if bad is None else _no(note, f"`git branch {bad}`")
    if sub in GIT_READ_SUBCMDS:
        return True
    return _no(note, f"`git {sub}`")


def _node_ok(rest):
    """`node --test …` — the JS suite, identical to what `make test-js` runs
    (free by its make target) but narrowable to one file. Any other node
    invocation is an unbounded program and meters."""
    if any(a in NODE_BAD or a.startswith(("--eval=", "--print=")) for a in rest):
        return False
    return "--test" in rest


def _stage_ok(mstage, ostage, is_head, note=None):
    clean = lex.analyze_redirects(mstage, ostage)
    if clean is None:
        return _no(note, "redirect outside the scratchpad")
    try:
        raw = shlex.split(clean, comments=False, posix=True)
    except ValueError:
        return _no(note, "unparsable command")
    if not raw:
        return _no(note, "empty command")
    # a stage that is only assignments binds names and runs nothing; the names
    # reappear downstream as `$S`, which is never a recognized command head
    if all(re.match(r"^[A-Za-z_]\w*=", t) for t in raw):
        return True
    toks = _strip_prefix(raw)
    if not toks:
        return _no(note, f"`{_cmd_name(raw[0])}` with nothing to run")
    name = _cmd_name(toks[0])
    rest = toks[1:]

    # `python scripts/gates/check_<x>.py …` — the repo's own verifiers, the ones
    # `make check` runs free. Relative path only; any other script meters.
    if is_head and re.match(r"^python[0-9.]*$", name) and rest and GATE_SCRIPT.match(rest[0]):
        return True

    # readers with read-only restrictions (valid head or downstream)
    if name == "sed":
        # read-only in no-autoprint mode (-n / -ne / -nE / --quiet / --silent),
        # never in-place (-i / -i.bak / bundle containing i / --in-place)
        short = [a for a in rest if a.startswith("-") and not a.startswith("--")]
        quiet = any(a in ("--quiet", "--silent") for a in rest) or any("n" in a for a in short)
        inplace = any(a.startswith("--in-place") for a in rest) or any("i" in a for a in short)
        if inplace:
            return _no(note, "`sed` rewriting in place")
        return quiet or _no(note, "`sed` lacking `-n`")
    if name == "find":
        bad = next((a for a in rest if a in FIND_BAD), None)
        return bad is None or _no(note, f"`find {bad}`")
    if name == "sort":
        bad = next((a for a in rest if a.startswith(("-o", "--output"))), None)
        return bad is None or _no(note, f"`sort {bad}`")
    if name == "rpm":
        # query mode only (-q / -ql / -qa / --query); never install/erase/etc.
        qmode = any(a.startswith("-q") or a == "--query" for a in rest)
        bad = next((a for a in rest if a in RPM_BAD), None)
        if qmode and bad is None:
            return True
        return _no(note, f"`rpm {bad}`" if bad else "`rpm` lacking `-q`")
    if name == "command":
        # locate only, never exec
        return "-v" in rest or "-V" in rest or _no(note, "`command` lacking `-v`")
    if name == "curl":
        return _curl_ok(rest) or _no(note, "`curl` is not a loopback GET")
    if name in ("pip", "pip3"):
        # read-only query subcommands only; install/uninstall/download/config mutate
        sub = next((a for a in rest if not a.startswith("-")), None)
        if sub in {"list", "show", "freeze", "check", "inspect"}:
            return True
        return _no(note, f"`pip {sub}`" if sub else "`pip` with no subcommand")
    if name in READERS:
        return True

    if not is_head:
        return _no(note, f"`{name}` is not a read-only pipe stage")

    # head-only sources / verifiers
    if name == "cd":
        # frees itself only; the next segment is judged alone
        return len(rest) <= 1 or _no(note, "`cd` with arguments")
    if name == "set":
        return all(SET_FLAGS.match(a) for a in rest) or _no(note, "`set` beyond shell flags")
    if name in ("source", "."):
        if len(rest) == 1 and _cmd_name(rest[0]) == SOURCEABLE:
            return True
        return _no(note, f"`source` needs `{SOURCEABLE}`")
    if name == "make":
        targets, i = [], 0
        while i < len(rest):
            a = rest[i]
            if a in ("-C", "--directory"):
                i += 2  # -C <dir>: not a target
                continue
            if not a.startswith("-"):
                targets.append(a)
            i += 1
        if not targets:
            return _no(note, "`make` with no target")
        bad = next((t for t in targets if t not in FREE_MAKE_TARGETS), None)
        return bad is None or _no(note, f"`make` target `{bad}`")
    if name in FREE_JS_CMDS:
        return True
    if name == "tsc":
        # emit is governed by the project config (both of this repo's set
        # noEmit); a bare `tsc file.js` writes JS next to the source
        return any(a in ("-p", "--project", "--noEmit") for a in rest) or _no(note, "`tsc` lacking `-p` or `--noEmit`")
    if name in ("ruff", "black"):
        # bare `black` and bare `ruff format` rewrite; `--check` only reports
        ok = "--check" in rest or (name == "ruff" and bool(rest) and rest[0] == "check")
        return ok or _no(note, f"`{name}` lacking `--check`")
    if name == "pdftotext":
        # output must be stdout (`-`) or a scratchpad file; never a repo path
        pos = [a for a in rest if a == "-" or not a.startswith("-")]
        if pos and (pos[-1] == "-" or lex.is_scratch(pos[-1])):
            return True
        return _no(note, "`pdftotext` writing outside the scratchpad")
    if name in FREE_PY_CMDS:
        return True
    if name == "pair.sh":
        # `list` prints the open /tests worktree pairs and touches nothing;
        # open / respec / red / merge / abort move branches and are meant to cost an action.
        if rest and rest[0] == "list":
            return True
        return _no(note, f"`pair.sh {rest[0]}`" if rest else "`pair.sh` with no subcommand")
    if name == "git":
        return _git_ok(rest, note)
    if name in ("node", "nodejs"):
        bad = next((a for a in rest if a in NODE_BAD), None)
        if bad is not None:
            return _no(note, f"`node {bad}`")
        return _node_ok(rest) or _no(note, "`node` lacking `--test`")
    return _no(note, f"`{name}` not on the free list")


def _seg_ok(mseg, oseg, note=None):
    stages = lex.split(mseg, oseg, r"\|")  # || is banned earlier, so | is a pipe
    if any(not o.strip() for _, o in stages):
        return _no(note, "empty pipe stage")
    if not _stage_ok(stages[0][0], stages[0][1], True, note):
        return False
    return all(_stage_ok(m, o, False, note) for m, o in stages[1:])


def is_free_bash(cmd, note=None):
    """True only for a purely read-only command (verification or investigation).
    Bias: any doubt returns False (the command meters).

    `note`, when given, collects the first reason the command was rejected —
    see _no(). Passing it changes no verdict.
    """
    try:
        if not cmd or not cmd.strip():
            return _no(note, "empty command")
        cmd = lex.SAFE_SUBST.sub("/SAFESUBST", cmd)
        masked = lex.mask(cmd)
        if masked is None:
            return _no(note, "unbalanced quote")
        for b in lex.BANNED_SUBSTR:
            if b in masked:
                return _no(note, f"`{b}` is never read-only")
        segs = [(m, o) for m, o in lex.split(masked, cmd, r"&&|;") if o.strip()]
        if not segs:
            return _no(note, "empty command")
        return all(_seg_ok(m, o, note) for m, o in segs)
    except Exception:
        return False  # parse failure -> not free -> meters (safe side)


def reason_metered(cmd):
    """Why `cmd` meters, in a few words naming a token from the command itself.

    Callers use this to explain a charge; it is not consulted for the verdict.
    Never empty: a rejection at a site nobody annotated still has to say
    something, or the counter prints a blank parenthesis.
    """
    note = []
    if is_free_bash(cmd, note):
        return ""
    return note[0] if note else "not on the free list"
