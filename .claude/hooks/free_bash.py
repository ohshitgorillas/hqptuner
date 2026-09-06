#!/usr/bin/env python3
"""The read-only Bash allowlist — verification and investigation.

change-budget.py owns the accounting; this owns the one question "is this shell
command purely read-only?", kept apart so the budget's file stays under the gate.

A command qualifies only when EVERY &&/;-segment and EVERY pipe-stage is a
recognized read-only command, output goes only to /dev/null / an fd-dup / the
session scratchpad, and there is no subshell, backtick, chained mutator, or
file-writing flag. Operator detection is quote-aware: a `>` or `|` inside a
quoted argument (e.g. `grep -o '<m [^>]*'`) is data, not a redirect.

Any doubt -> it meters. A false-meter costs one report; a false-free would let a
mutation slip past the budget, so the bias is always toward metering.
"""
import re
import shlex

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
           "echo", "printf",
           # checksums: read a file, print a digest, and have no output flag to
           # guard. Verifying a file is unchanged should not cost a report.
           "sha256sum", "md5sum", "b2sum", "cksum"}
# rpm/dpkg mutating flags — presence disqualifies the query
RPM_BAD = {"-i", "-U", "-F", "-e", "--install", "--upgrade", "--freshen",
           "--erase", "--import", "--rebuilddb", "--setperms", "--setugids"}
# `find` actions that execute or mutate
FIND_BAD = {"-exec", "-execdir", "-delete", "-ok", "-okdir",
            "-fprint", "-fprint0", "-fprintf", "-fls"}
# git subcommands that only read history/state. Deliberately absent: branch,
# tag, stash, reflog, notes, config — each has a mutating flag form, and
# telling those apart is not worth the parser.
GIT_READ_SUBCMDS = {"log", "show", "diff", "status", "blame", "shortlog",
                    "rev-parse", "rev-list", "ls-files", "ls-tree", "cat-file",
                    "describe", "name-rev", "whatchanged", "check-ignore"}
# git global options that cannot change WHICH code runs. `-c k=v` is absent on
# purpose: it can define an alias or a textconv filter that executes.
GIT_GLOBAL_FLAGS = {"--no-pager", "-P", "--literal-pathspecs",
                    "--no-replace-objects", "--bare"}
# `git branch` flags that write a ref instead of listing them
GIT_BRANCH_BAD = {"-d", "-D", "-m", "-M", "-c", "-C", "-f", "--delete", "--move",
                  "--copy", "--force", "--set-upstream-to", "-u",
                  "--unset-upstream", "--edit-description"}
# node flags that hand it a program on the command line instead of a test file
NODE_BAD = {"-e", "--eval", "-p", "--print", "-i", "--interactive"}
# JS-side verifiers, reached through `npx`. They read and report; the flags that
# would make them rewrite (--fix, --write) are in BANNED_SUBSTR already.
FREE_JS_CMDS = {"eslint", "knip", "jscpd", "prettier"}
# `set` flags that only change shell options — `set -a` before sourcing creds
SET_FLAGS = re.compile(r'^[-+][aeux]$')
# The one file a `source` may name: the gitignored dev credentials at repo root.
SOURCEABLE = "hqpcreds"
# Command substitutions that cannot run anything but themselves. Rewritten to a
# plain word before the `$(` ban is applied, so every other substitution meters.
SAFE_SUBST = re.compile(r'\$\((?:pwd|git rev-parse --show-toplevel)\)')
# the one script a bare `python` head may run free: a gate, by relative path
GATE_SCRIPT = re.compile(r'^scripts/gates/check_[a-z0-9_]+\.py$')

# substrings that can never appear benignly OUTSIDE quotes in a read-only command
BANNED_SUBSTR = ("`", "$(", "<(", ">(", "||", "--fix", "--write", "--in-place",
                 "--output")

_REDIR_OP = re.compile(r'(\d*)(&>>|&>|>>|>&|>)')      # optional fd + output op
_BG_AMP = re.compile(r'(?<![>&])&(?![&>])')            # a lone background &


def _cmd_name(tok):
    return tok.rsplit("/", 1)[-1]  # strip path: .venv/bin/pytest -> pytest


def _no(note, reason):
    """Record why this command meters, then reject it. Every reason echoes a
    token from the command itself, so read-volume.py's counter can name it."""
    if note is not None and not note:
        note.append(reason)
    return False


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
        r'^https?://(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?([/?].*)?$',
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
            i += 2                                    # -C <path>
        elif a in GIT_GLOBAL_FLAGS or a.startswith(("--git-dir=", "--work-tree=")):
            i += 1
        else:
            break
    if i >= len(rest):
        return _no(note, "`git` with no subcommand")
    sub, args = rest[i], rest[i + 1:]
    if sub == "worktree":
        if args and args[0] == "list":                # add/remove move trees
            return True
        return _no(note, f"`git worktree {args[0] if args else ''}`")
    if sub == "branch":
        bad = next((a for a in args if a in GIT_BRANCH_BAD
                    or a.startswith("--set-upstream-to=")), None)
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
    clean = _analyze_redirects(mstage, ostage)
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
    if all(re.match(r'^[A-Za-z_]\w*=', t) for t in raw):
        return True
    toks = _strip_prefix(raw)
    if not toks:
        return _no(note, f"`{_cmd_name(raw[0])}` with nothing to run")
    name = _cmd_name(toks[0])
    rest = toks[1:]

    # `python scripts/gates/check_<x>.py …` — the repo's own verifiers, the ones
    # `make check` runs free. Relative path only; any other script meters.
    if is_head and re.match(r'^python[0-9.]*$', name) and rest and GATE_SCRIPT.match(rest[0]):
        return True

    # readers with read-only restrictions (valid head or downstream)
    if name == "sed":
        # read-only in no-autoprint mode (-n / -ne / -nE / --quiet / --silent),
        # never in-place (-i / -i.bak / bundle containing i / --in-place)
        short = [a for a in rest if a.startswith("-") and not a.startswith("--")]
        quiet = (any(a in ("--quiet", "--silent") for a in rest)
                 or any("n" in a for a in short))
        inplace = (any(a.startswith("--in-place") for a in rest)
                   or any("i" in a for a in short))
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
                i += 2                                # -C <dir>: not a target
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
        return (any(a in ("-p", "--project", "--noEmit") for a in rest)
                or _no(note, "`tsc` lacking `-p` or `--noEmit`"))
    if name in ("ruff", "black"):
        # bare `black` and bare `ruff format` rewrite; `--check` only reports
        ok = "--check" in rest or (name == "ruff" and bool(rest) and rest[0] == "check")
        return ok or _no(note, f"`{name}` lacking `--check`")
    if name == "pdftotext":
        # output must be stdout (`-`) or a scratchpad file; never a repo path
        pos = [a for a in rest if a == "-" or not a.startswith("-")]
        if pos and (pos[-1] == "-" or _is_scratch(pos[-1])):
            return True
        return _no(note, "`pdftotext` writing outside the scratchpad")
    if name in FREE_PY_CMDS:
        return True
    if name == "pair.sh":
        # `list` prints the open /tests worktree pairs and touches nothing;
        # open / red / merge / abort move branches and are meant to cost an action.
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
    stages = _split(mseg, oseg, r'\|')     # || is banned earlier, so | is a pipe
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
        cmd = SAFE_SUBST.sub("/SAFESUBST", cmd)
        masked = _mask(cmd)
        if masked is None:
            return _no(note, "unbalanced quote")
        for b in BANNED_SUBSTR:
            if b in masked:
                return _no(note, f"`{b}` is never read-only")
        segs = [(m, o) for m, o in _split(masked, cmd, r'&&|;') if o.strip()]
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
