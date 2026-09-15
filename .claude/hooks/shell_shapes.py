#!/usr/bin/env python3
"""Shell and path shapes the lane hooks share.

The lane hooks all ask the same two questions: does this path fall inside a
directory that belongs to one agent, and does this shell command write
anything. This module answers both, so that a hook is a policy over the
answers rather than a second parser.

It holds the shape of a lane hook too, at the end: the dispatch from a tool
call to the handler for its kind, the entry point that reads a payload and
prints a denial, the sentence a shell write into a lane is refused with, and
the whole policy of a lane one named agent writes. Those were the same text in
five files, which is the arrangement where one hook gets a fix and four keep
the defect.

It is deliberately standalone. These hooks travel as a unit into other repos,
where the change budget and its `free_bash` allowlist do not exist, so the
read-only judgment here is two small closed allowlists of its own, read in
this order: a redirection makes any command a write whatever it says; a
recognized runner invocation is a read, because running the suite is the job
and a head word cannot tell a suite run from an interpreter writing a file;
otherwise a command is a read only if its first word is a known reader.
Unknown command, unknown effect, treated as a write. That is the safe
direction for a lane: an over-denied read costs a message, an under-denied
write costs the lane.

The runner table is whole invocations, not head words. `pytest` is the one
head accepted with arbitrary arguments, and it was a known reader before the
table existed; every other entry names the argument that makes it a run
(`python -m pytest`, `node --test`, `npm test`, `npx vitest`, `cargo test`).
An inline-script flag (`-e`, `-c`, `-p`, `--eval`, `--print`) is never a run,
whatever the head word: that is the shape an agent reaches for to write a
file with an interpreter the lane would otherwise wave through.

The kit's own blind runner, `scripts/blind.sh test <path>`, is in the table
too, keyed on the whole invocation and its arity like every other entry: the
head is that script, `test` follows it, and exactly one argument follows
that, matching the test-directory shape both as typed and after
`os.path.normpath`, so an argument that opens under the lane and walks out of
it is not a run.

`blind-reads.json` beside this file carries seven keys, and they are the whole
of what varies between the projects this kit is copied into. Three name
directories. `tests_dir` is the blind writer's lane, `tests` by default, and what
the agent definitions and the docs mean by `<tests dir>`. `gauntlet_dir` is where
the chain's artifacts live, `gauntlet` by default. `docs_dir` is the prose a
blind agent may read, `docs` by default. The structure under `gauntlet_dir` does
not move: the four lanes are always `plans/approved`, `specs/approved`,
`verdicts` and `reviews` beneath it, because that shape is the kit's identity
rather than a project's layout.

The other two are what `scripts/pair.sh merge` converges onto, and they are
scalars rather than paths. `target_branch` is the branch a finished pair lands
on, `main` by default. `gate_command` is the command that has to pass in the
combined tree before it lands, `make check` by default. They validate
independently of the three directories and of each other: a name a project
cannot use falls back on its own, because neither one can collide with a lane
the way two directories can. The default gate is a command most projects either
have or notice the absence of at once, which is the safe direction -- a gate
that cannot run holds the pair in its worktrees rather than landing it unchecked.

The last two are the runner invocations `scripts/blind.sh test` and
`scripts/pair.sh red` type. `pytest_command` is `.venv/bin/pytest` by default,
`node_command` is `node --test`, and a project that has to deselect a marker or
import a loader names the whole invocation once here instead of editing the two
scripts by hand. Each is a command line split the way a shell splits it, and
`--config` prints one word per line, so an argument carrying a space survives
the trip into a shell array. They resolve per key like the scalars, for the same
reason: a runner collides with nothing. The callers add the test path and their
own trailing flags after the configured words, and a configured word carrying a
slash is a path in the checkout while a bare word is on `PATH`. A runner is
configuration and never agent input: `blind-bash.py` admits `scripts/blind.sh
test <path>` and no runner argument beside it, so no shape here widens the one
command a blind agent has.

No lane is a literal any more, so the bound on this file is no longer that a
lane is code a data file cannot reach. The bound is that the three names must
be usable and pairwise disjoint: each a repo-relative normalized path, none of
them the root, absolute or walking out, and none equal to, under, or over
another. A set failing any of those is not partly honoured -- every key falls
back to its default together. Per-key fallback is unsound once the lanes are
data: `tests_dir` naming `docs` is legal alone and collides the moment a
malformed `docs_dir` falls back to `docs`, which would hand the blind writer a
lane over the prose it reads.

Nothing else is in the file. The readable set is `no-impl-reads.py`'s own
table, and the agent names are the kit's identity, copied verbatim.

The owner's off switch lives here too, as `bypassed()`. This module is the one
place all seven hooks already share, so the switch is defined once and each
hook reads it rather than each hook parsing an environment of its own. It reads
`os.environ` and never a hook payload: the payload is the one input an agent
controls, and a switch honouring a payload key would be a bypass any subagent
could forge in a tool call.
"""

from __future__ import annotations

import functools
import json
import os
import re
import shlex
import sys

#: first words of commands that only read; anything else is treated as a write
READ_ONLY = frozenset(
    {
        "basename",
        "cat",
        "cksum",
        "cmp",
        "column",
        "comm",
        "cut",
        "diff",
        "dirname",
        "du",
        "echo",
        "false",
        "fgrep",
        "file",
        "grep",
        "head",
        "jq",
        "less",
        "ls",
        "md5sum",
        "nl",
        "od",
        "printf",
        "pwd",
        "realpath",
        "rg",
        "sha256sum",
        "sort",
        "stat",
        "tail",
        "test",
        "tr",
        "true",
        "uniq",
        "wc",
        "which",
        "xxd",
        "yq",
    }
)

#: `find` actions that run something or write a file; without one of these a
#: `find` prints names and is the reader every search starts with
FIND_WRITE_ACTIONS = frozenset(
    {
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls",
    }
)

#: `xargs` options that take a value as the next word, so the word after one is
#: not the command `xargs` runs
XARGS_VALUE_FLAGS = frozenset(
    {
        "-a",
        "-d",
        "-E",
        "-e",
        "-I",
        "-i",
        "-L",
        "-l",
        "-n",
        "-P",
        "-s",
        "--arg-file",
        "--delimiter",
        "--eof",
        "--replace",
        "--max-lines",
        "--max-args",
        "--max-procs",
        "--max-chars",
        "--process-slot-var",
    }
)

#: what an `awk` program does besides print to stdout. `>` and `>>` open a file,
#: `|` hands a line to a shell, and `system` runs one. A program held in a file
#: (`-f`) is not on the command line at all, so it is unknown and counts as a
#: write like any other unknown effect.
AWK_WRITE_MARKS = (">", "|", "system(")

#: `ruff` invocations that only report. `check` writes nothing unless it is
#: asked to, and `format` writes unless it is asked not to.
RUFF_CHECK_WRITE_FLAGS = frozenset({"--fix", "--unsafe-fixes", "--add-noqa"})
RUFF_FORMAT_READ_FLAGS = frozenset({"--check", "--diff"})

#: an interpreter told to run a script given on the command line; never a run
#: of the suite. Which flag means that depends on the head word in front of it,
#: so the set is read through `has_inline_script`, never against a bare word
#: list: `-c` is an inline script to `python` and a config file to `pytest`,
#: and `-p` is an inline script to `perl` and a plugin to `pytest`.
INLINE_SCRIPT = frozenset({"-e", "-c", "-p", "--eval", "--print"})

#: heads for which `-c` is an inline script rather than a configuration file
INLINE_C_HEADS = frozenset({"sh", "bash", "zsh", "ruby", "perl", "php"})
#: heads for which `-p`/`--print` is an inline script rather than an argument
INLINE_P_HEADS = frozenset({"perl", "node"})

#: `pytest` arguments that make it write somewhere of its own choosing, so the
#: invocation stops being a run of the suite and falls to the ordinary path test
PYTEST_WRITE_FLAGS = (
    "--junitxml",
    "--junit-xml",
    "--report-log",
    "--result-log",
    "--cov-report",
    "--basetemp",
)

#: git subcommands that print no file content; everything else prints some, and
#: an unrecognized subcommand is treated as content. Staging and committing
#: belong here: they print no tree, and leaving them out denies the blind test
#: writer the commit its own red run depends on. `GIT_NO_WORKTREE` below asks a
#: different question, whether a subcommand writes, not whether it prints:
#: `cat-file`, `grep` and `show` write nothing and print content, so they are
#: there and not here. The two lists share `add`, `commit`, `describe`,
#: `ls-files`, `merge-base`, `rev-list`, `rev-parse` and `status`.
GIT_METADATA = frozenset(
    {
        "status",
        "rev-parse",
        "ls-files",
        "branch",
        "describe",
        "remote",
        "config",
        "symbolic-ref",
        "merge-base",
        "rev-list",
        "tag",
        "add",
        "commit",
        "restore",
        "checkout",
        "switch",
        "worktree",
        "reset",
    }
)
#: flags that turn `git log` from a list of commits into a patch
GIT_PATCH_FLAGS = frozenset({"-p", "-u", "--patch", "--full-diff"})

#: packages `npx` may run as a test runner
NPX_RUNNERS = frozenset({"ava", "jest", "mocha", "playwright", "tap", "vitest"})

#: modules `python -m` may run as a test runner
PY_MODULES = frozenset({"pytest", "unittest"})

#: a slug names one path segment and carries no traversal
SLUG = r"[A-Za-z0-9][A-Za-z0-9._-]*"
#: a spec worktree is the other place a blind agent's tests live, so the blind
#: runner's argument may carry that one prefix and no other: the writer runs
#: the suite in the tree it wrote in
TREE = rf"\.claude/worktrees/{SLUG}-spec/"

#: the lane directories this kit's hooks guard are not literals: they are the
#: four fixed suffixes below, under whatever `gauntlet_dir` resolves to.
#: `LANE_DIRS` is derived beside the rest of the config, further down this file.
LANE_SUFFIXES = ("plans/approved", "specs/approved", "verdicts", "reviews")

#: git subcommands that never write the working tree in their reading forms; a
#: commit message or a pathspec naming a lane is not a write to it. Membership
#: is conditional: `git_write_form` counts a member's stage as a write when it
#: carries `--output`, `grep -O` or a writing `reflog` form.
GIT_NO_WORKTREE = frozenset(
    {
        "add",
        "blame",
        "cat-file",
        "commit",
        "describe",
        "diff",
        "grep",
        "log",
        "ls-files",
        "ls-tree",
        "merge-base",
        "reflog",
        "rev-list",
        "rev-parse",
        "shortlog",
        "show",
        "status",
    }
)

#: git global options that consume the word after them. Every other `-…` word
#: before the subcommand stands alone, and `--opt=value` is already one word.
GIT_VALUED_GLOBALS = frozenset({"-C", "-c", "--git-dir", "--work-tree", "--namespace"})

#: git global options that decide what the subcommand runs, rather than where
#: it runs. `-c alias.<name>=!<command>` redefines a subcommand into a shell
#: command, and each of these names a program git execs. `git_parts` refuses to
#: split an invocation carrying one, so it stays unrecognized and is denied.
GIT_EXEC_GLOBALS = frozenset({"--exec-path", "--upload-pack", "--receive-pack"})

#: `--output=<file>` writes a file wherever git takes its diff options
GIT_OUTPUT = "output"
#: `git grep -O[<pager>]` runs a command on the matching files
GIT_GREP_PAGER = "open-files-in-pager"
#: `git reflog` forms that change the reflog rather than print it
GIT_REFLOG_WRITES = frozenset({"write", "delete", "drop", "expire"})

#: an output redirection and the target it opens. A file-descriptor prefix
#: (`1>`, `2>`) and `&>` are redirections; `2>&1` and `>&2` duplicate a
#: descriptor and open nothing, which is what the `(?![&>])` lookahead excludes.
#: The prefix is not what tells those apart, so it is not excluded here.
#:
#: Scanned against `mask_quoted`, never against the raw stage: a `>` inside a
#: quoted argument is a character the command is given, not a redirection the
#: shell performs, and `grep -n "a > b" tests/` is a read.
REDIRECT = re.compile(r"(?:^|[^<>&])(?:\d*|&)>>?(?![&>])\s*([^\s;|&)]*)")

#: a redirection to this target changes nothing on disk
NULL_TARGET = "/dev/null"

_HEREDOC = re.compile(r"<<-?\s*(['\"]?)([\w][\w.-]*)\1")

#: what a quoted character is replaced with while a stage is scanned for
#: redirections. It is not a shell metacharacter and it is not a path
#: character, so no pattern here can match across it.
_MASK = "\x00"


def mask_quoted(text: str) -> str:
    """`text` with the inside of every quoted span blanked, length preserved.

    The quote characters themselves stay, so a scan still sees where an
    argument began, and every index in the result is the index of the same
    character in the input — which is what lets a match found here be read
    back out of the original string.

    An unterminated quote quotes to the end of the string, the same reading
    `_split_unquoted` takes.
    """
    out: list[str] = []
    quote: str | None = None
    for ch in text:
        if quote is not None:
            out.append(quote if ch == quote else _MASK)
            quote = None if ch == quote else quote
        elif ch in "'\"":
            quote = ch
            out.append(ch)
        else:
            out.append(ch)
    return "".join(out)


def redirect_targets(segment: str) -> list[str]:
    """Every file this stage's redirections open, `/dev/null` excluded.

    The scan runs over the masked stage and the target is sliced back out of
    the unmasked one, so a redirection to a quoted path (`> "tests/t.py"`)
    yields the path rather than the mask.
    """
    out: list[str] = []
    for target in _redirections(segment):
        if target and target != NULL_TARGET:
            out.append(target)
    return out


def _redirections(segment: str) -> list[str]:
    """The target text of every redirection in the stage, in order."""
    masked = mask_quoted(segment)
    return [segment[m.start(1) : m.end(1)].strip("\"'") for m in REDIRECT.finditer(masked)]


def redirect_writes(segment: str) -> bool:
    """Does any redirection in this stage open something other than `/dev/null`?

    Asked per redirection, not per stage. A stage carries more than one, and a
    stage-level answer would let `cat impl.py > tests/t.py 2>/dev/null` off on
    the harmless half of it. A redirection whose target this parser cannot read
    is a write too, which is why the test is against the target text and not
    against the list `redirect_targets` has already filtered.
    """
    return any(target != NULL_TARGET for target in _redirections(segment))


def strip_heredocs(command: str) -> str:
    """Drop heredoc bodies, so prose that mentions a lane is not read as a path.

    The redirection that opens the heredoc stays on its own line, so
    `cat > lane/x.txt <<EOF` is still seen as the write it is.
    """
    out: list[str] = []
    terminator: str | None = None
    for line in command.split("\n"):
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        out.append(line)
        m = _HEREDOC.search(line)
        if m:
            terminator = m.group(2)
    return "\n".join(out)


def _split_unquoted(text: str) -> list[str]:
    """Split on `&&`, `||`, `;`, `|`, a newline and a bare `&`, outside quotes.

    A separator inside a quoted argument is part of the argument: splitting
    `node -e "a && b"` on it would leave fragments whose head word is not a
    command. A `&` next to a redirection (`2>&1`, `>&2`) is not a separator
    either — cutting there leaves a fragment ending in `2>`, which `REDIRECT`
    reads as an output redirection and every lane then reads as a write.

    An unterminated quote quotes to the end of the string, so a malformed
    command is one segment and falls to whatever its head word says.
    """
    out: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote is not None:
            buf.append(ch)
            quote = None if ch == quote else quote
            i += 1
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
            i += 1
        elif text.startswith("&&", i) or text.startswith("||", i):
            out.append("".join(buf))
            buf = []
            i += 2
        elif ch in ";|\n":
            out.append("".join(buf))
            buf = []
            i += 1
        elif ch == "&" and not ((i and text[i - 1] in ">&") or (i + 1 < len(text) and text[i + 1] in ">&")):
            out.append("".join(buf))
            buf = []
            i += 1
        else:
            buf.append(ch)
            i += 1
    out.append("".join(buf))
    return [s.strip() for s in out if s.strip()]


def segments(command: str) -> list[str]:
    """The pipeline stages of a command, heredoc bodies removed."""
    return _split_unquoted(strip_heredocs(command))


def segments_with_bodies(command: str) -> list[tuple[str, str]]:
    """Each stage, paired with the heredoc body opened on that stage's line.

    `segments` drops every body before a caller sees it, which is right for a
    question about what a command *does* — the head word already answers that.
    It is wrong for a question about *which path* a stage touches, because the
    path a heredoc names lives in the body. The body attaches to the last stage
    of the line that opened it, which is the stage carrying the `<<`.

    A body is evidence about the target of a write, never evidence that a write
    happened: `lane_write_in` reads one only for a stage that already
    classifies as a write, so `cat <<EOF` carrying prose stays prose.
    """
    units: list[tuple[str, str]] = []
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        body: list[str] = []
        for match in _HEREDOC.finditer(line):
            terminator = match.group(2)
            #: an unterminated heredoc runs to the end of the input, as it does
            #: in the shell, so the body is whatever is left
            while i < len(lines) and lines[i].strip() != terminator:
                body.append(lines[i])
                i += 1
            i += 1 if i < len(lines) else 0
        stages = _split_unquoted(line)
        for index, stage in enumerate(stages):
            last = index == len(stages) - 1
            units.append((stage, "\n".join(body) if last else ""))
    return units


#: shell keywords that stand in front of the command a stage runs. Stripping
#: them is what makes `do rm t.py` a `rm` rather than an unknown head word, and
#: an unknown head word is a write.
KEYWORD_PREFIXES = frozenset({"if", "while", "until", "then", "else", "elif", "do", "!", "time", "{"})

#: stage heads that run no command at all. A `for ... in <list>` header binds a
#: variable, `done` and `fi` close a block: nothing in them touches the disk, so
#: a lane path quoted in a `for` list is a string and not a target.
NO_COMMAND_HEADS = frozenset({"for", "select", "case", "in", "done", "fi", "esac", "}", ")", ";;"})


def command_words(words: list[str]) -> list[str]:
    """The words of the command a stage runs, shell keywords stripped.

    A leading `(` is part of the head word as `shlex` splits it, so it comes off
    here: `(echo x > t)` runs `echo`, and reading its head as `(echo` makes an
    unknown command out of a known one.
    """
    out = list(words)
    while out and out[0] in KEYWORD_PREFIXES:
        out = out[1:]
    if out:
        head = out[0].lstrip("(")
        out = ([head] + out[1:]) if head else out[1:]
    return out


def _find_reads(words: list[str]) -> bool:
    """`find` prints names unless it is given an action that runs or writes."""
    return not any(w in FIND_WRITE_ACTIONS for w in words[1:])


def _xargs_reads(words: list[str]) -> bool:
    """`xargs` is whatever it runs, so the question recurses onto that command."""
    rest = words[1:]
    i = 0
    while i < len(rest):
        word = rest[i]
        if word in XARGS_VALUE_FLAGS:
            i += 2
            continue
        if word.startswith("-"):
            i += 1
            continue
        break
    run = rest[i:]
    return bool(run) and reads_only(run)


def _awk_reads(words: list[str]) -> bool:
    """`awk` prints to stdout unless its program opens a file or runs a command."""
    for word in words[1:]:
        if word in ("-f", "--file") or word.startswith("--file="):
            return False
        if any(mark in word for mark in AWK_WRITE_MARKS):
            return False
    return True


def _ruff_reads(words: list[str]) -> bool:
    """`ruff check` reports; `ruff format` rewrites unless asked only to report."""
    rest = [w for w in words[1:] if not w.startswith("-")]
    flags = [w for w in words[1:] if w.startswith("-")]
    sub = rest[0] if rest else ""
    if sub == "check":
        return not any(f.split("=", 1)[0] in RUFF_CHECK_WRITE_FLAGS for f in flags)
    if sub == "format":
        return any(f.split("=", 1)[0] in RUFF_FORMAT_READ_FLAGS for f in flags)
    return sub in ("rule", "linter", "version", "config")


#: heads whose read-only answer depends on the rest of the invocation. They are
#: the shapes every search and every gate run reaches for, and a head-word list
#: cannot hold them: `find tests` prints and `find tests -delete` empties.
CONDITIONAL_READERS = {
    "find": _find_reads,
    "xargs": _xargs_reads,
    "awk": _awk_reads,
    "gawk": _awk_reads,
    "mawk": _awk_reads,
    "ruff": _ruff_reads,
}


def reads_only(words: list[str]) -> bool:
    """Is this invocation, head word and arguments together, a read?

    The unconditional list first, then the table above. `sed` is the one head
    answered in `segment_writes` instead, because its write form is a flag
    cluster rather than a word.
    """
    if not words:
        return True
    head = os.path.basename(words[0])
    if head in READ_ONLY:
        return True
    if head == "sed":
        return not any(w == "-i" or w.startswith("-i") for w in words[1:])
    checker = CONDITIONAL_READERS.get(head)
    return bool(checker) and checker(words)


def has_inline_script(words: list[str]) -> bool:
    """Is this invocation an interpreter told to run a script given inline?

    Read against the head word. `-e` and `--eval` are that shape for every head
    that has them; `-c` only for a shell or an interpreter; `-p` and `--print`
    only for `perl` and `node`. A bare `-` is the same shape by another road —
    it is how `python3 - <<EOF` feeds a script in without a flag at all.
    """
    if not words:
        return False
    head = os.path.basename(words[0])
    for word in words[1:]:
        if word in ("-e", "--eval", "-"):
            return True
        if word == "-c" and (head.startswith("python") or head in INLINE_C_HEADS):
            return True
        if word in ("-p", "--print") and head in INLINE_P_HEADS:
            return True
    return False


def path_shape(prefix: str) -> str:
    """The regex source a path prefix expands into.

    Repo-relative, under `prefix`, optionally inside a spec worktree. The
    trailing class admits `.` and `/`, so it admits `..` as well: the shape is
    not the whole key, and `is_blind_run` normalizes what it matches.
    """
    return rf"(?:{TREE})?{re.escape(prefix)}/[A-Za-z0-9_][A-Za-z0-9._/-]*"


def config() -> dict:
    """The one per-repo value, from `blind-reads.json` beside this file.

    An unreadable or malformed file is an empty config, which is the default
    lane: a typo in the file moves nothing.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blind-reads.json")
    try:
        with open(path, encoding="utf-8") as fh:
            loaded = json.load(fh)
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _under(path: str, parent: str) -> bool:
    """Is `path` `parent` itself, or something beneath it? Both normalized."""
    return path == parent or path.startswith(parent + "/")


# --- the three directories a project names, and what they are when it does not


#: the directory keys `blind-reads.json` carries, and the value each takes when
#: the file is absent, malformed, or names a set that cannot be used. There is no
#: fourth directory: see the module docstring for what stays in code and why.
DEFAULT_DIRS = {
    "tests_dir": "tests",
    "gauntlet_dir": "gauntlet",
    "docs_dir": "docs",
}

#: the two scalar keys, and the value each takes when the file names none. They
#: are what `scripts/pair.sh merge` converges onto: the branch a finished pair
#: lands on, and the command that has to pass before it does.
DEFAULT_SCALARS = {
    "target_branch": "main",
    "gate_command": "make check",
}

#: the two runner keys, and the invocation each takes when the file names none.
#: They are what `scripts/blind.sh test` and `scripts/pair.sh red` run, without
#: the test path and the trailing flags a caller adds after them.
DEFAULT_RUNNERS = {
    "pytest_command": ".venv/bin/pytest",
    "node_command": "node --test",
}


def _clean(name) -> str | None:
    """One repo-relative directory, or `None` when the name cannot be one.

    Normalized, so a traversal is judged by where it lands rather than by how
    it is spelled. The root, an absolute path and a name walking out of the
    checkout are all `None`: none of them names a directory inside the repo.
    """
    if not isinstance(name, str) or not name:
        return None
    name = os.path.normpath(name).replace(os.sep, "/")
    if os.path.isabs(name) or name in (".", "..") or name.startswith("../"):
        return None
    return name


def _scalar(value) -> str | None:
    """One configured scalar, or `None` when the value cannot be one.

    A scalar is a single non-empty line with no leading or trailing blanks left
    on it. A newline inside it is what separates a branch name from a second
    command smuggled after it, so a multi-line value is not a scalar at all.
    """
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or "\n" in value or "\r" in value:
        return None
    return value


def _words(value) -> list[str] | None:
    """One runner invocation as words, or `None` when the value cannot be one.

    A command line, split the way a shell splits it, so a marker expression
    stays one word. An unparsable line, an empty one, and anything that is not
    a string are all `None`: none of them names a command to run.
    """
    if not isinstance(value, str):
        return None
    try:
        words = shlex.split(value, comments=False, posix=True)
    except ValueError:
        return None
    return words or None


def runners_from(conf: dict) -> dict:
    """The two runner invocations this config resolves to, defaults filled in.

    Per key, like the scalars: a runner overlaps no lane and no other runner, so
    an unusable `pytest_command` leaves the node one standing.
    """
    resolved = {}
    for key, default in DEFAULT_RUNNERS.items():
        words = _words(conf.get(key)) if key in conf else None
        resolved[key] = words if words is not None else shlex.split(default)
    return resolved


def scalars_from(conf: dict) -> dict:
    """The two scalars this config resolves to, defaults filled in.

    Per key, unlike the directories: a scalar cannot overlap a lane or another
    scalar, so an unusable branch name has nothing to take down with it and the
    gate keeps whatever the project named.
    """
    resolved = {}
    for key, default in DEFAULT_SCALARS.items():
        name = _scalar(conf.get(key)) if key in conf else None
        resolved[key] = name if name is not None else default
    return resolved


def dirs_from(conf: dict) -> dict:
    """The three directories this config resolves to, defaults filled in.

    All or nothing. A key that cannot be a directory, or any pair that overlaps
    -- equal, under, or over -- voids the whole set and every key takes its
    default. A key the file omits takes its default and is still checked against
    the rest, so naming `tests_dir` as `docs` collides with the default
    `docs_dir` exactly as it would with a declared one.
    """
    resolved = {}
    for key, default in DEFAULT_DIRS.items():
        if key not in conf:
            resolved[key] = default
            continue
        name = _clean(conf.get(key))
        if name is None:
            return dict(DEFAULT_DIRS)
        resolved[key] = name
    names = list(resolved.values())
    for position, one in enumerate(names):
        for other in names[position + 1 :]:
            if _under(one, other) or _under(other, one):
                return dict(DEFAULT_DIRS)
    return resolved


@functools.lru_cache(maxsize=1)
def dirs() -> dict:
    """The resolved set, read once per process."""
    return dirs_from(config())


@functools.lru_cache(maxsize=1)
def scalars() -> dict:
    """The resolved scalars, read once per process."""
    return scalars_from(config())


@functools.lru_cache(maxsize=1)
def runners() -> dict:
    """The resolved runner invocations, read once per process."""
    return runners_from(config())


def pytest_command() -> list[str]:
    """The python runner, without the test path a caller adds after it."""
    return list(runners()["pytest_command"])


def node_command() -> list[str]:
    """The javascript runner, without the test path a caller adds after it."""
    return list(runners()["node_command"])


def target_branch() -> str:
    """The branch a finished pair lands on."""
    return scalars()["target_branch"]


def gate_command() -> str:
    """The command that has to pass in the combined tree before it lands."""
    return scalars()["gate_command"]


def tests_dir() -> str:
    """The blind writer's lane."""
    return dirs()["tests_dir"]


def gauntlet_dir() -> str:
    """The base every lane sits under."""
    return dirs()["gauntlet_dir"]


def docs_dir() -> str:
    """The prose a blind agent may read."""
    return dirs()["docs_dir"]


def lane(suffix: str) -> str:
    """One of the four fixed lane suffixes, under the configured base."""
    return gauntlet_dir() + "/" + suffix


def plans_lane() -> str:
    """The gauntlet-prosecutor's lane."""
    return lane("plans/approved")


def specs_lane() -> str:
    """The gauntlet-arbiter's lane."""
    return lane("specs/approved")


def verdicts_lane() -> str:
    """The gauntlet-juror's lane."""
    return lane("verdicts")


def reviews_lane() -> str:
    """The reviewers' lane."""
    return lane("reviews")


#: the lane directories this kit's hooks guard, in the order `LANE_SUFFIXES`
#: gives them
LANE_DIRS = tuple(lane(suffix) for suffix in LANE_SUFFIXES)


#: what `--config <key>` answers: the seven keys the file carries, and the four
#: derived lanes, so a shell script asks for a lane rather than rebuilding one
#: out of the base and a suffix it would have to hardcode. A runner answers one
#: word per line; every other key answers one line.
CONFIG_READERS = {
    "tests_dir": tests_dir,
    "gauntlet_dir": gauntlet_dir,
    "docs_dir": docs_dir,
    "target_branch": target_branch,
    "gate_command": gate_command,
    "pytest_command": pytest_command,
    "node_command": node_command,
    "plans_lane": plans_lane,
    "specs_lane": specs_lane,
    "verdicts_lane": verdicts_lane,
    "reviews_lane": reviews_lane,
}


def config_lines(key: str) -> list[str]:
    """One config value as lines a shell reads with `read`.

    A known key is one line, except a runner invocation, which is one word per
    line: a word carrying a space is one word to the shell that reads it back.
    An unknown key is no lines.
    """
    reader = CONFIG_READERS.get(key)
    if not reader:
        return []
    value = reader()
    return list(value) if isinstance(value, list) else [value]


#: the shape the blind runner's one argument takes, exported so that
#: `blind-bash.py` reads the same regular expression the classifier does
TESTPATH = path_shape(tests_dir())


#: the kit's own blind runner: this script, `test`, one path under the lane
BLIND_ENTRY = "scripts/blind.sh"
_TESTPATH_WHOLE = re.compile(TESTPATH + r"\Z")


def is_blind_run(words: list[str]) -> bool:
    """Is this whole invocation `scripts/blind.sh test <path under the lane>`?

    The key is the whole invocation, arity included: the head normalizes to
    the entry or to a path ending in it, `test` comes next, and exactly one
    argument follows. That argument matches the lane shape both as typed and
    after `os.path.normpath`, so an argument that opens under the lane and
    walks out of it is not a run. `status` and `show` take no path the lane
    hooks care about and fall to the path test like any other command.
    """
    if len(words) != 3 or words[1] != "test":
        return False
    head = os.path.normpath(words[0])
    if head != BLIND_ENTRY and not head.endswith("/" + BLIND_ENTRY):
        return False
    arg = words[2]
    return bool(_TESTPATH_WHOLE.match(arg) and _TESTPATH_WHOLE.match(os.path.normpath(arg)))


def is_runner(words: list[str]) -> bool:
    """Is this invocation a run of the project's suite, rather than a write?

    A closed table of whole invocations. `pytest` is the only head word
    accepted with arbitrary arguments; everything else names the argument that
    makes it a run. An inline-script flag disqualifies any of them.

    The kit's own `scripts/blind.sh test <path>` is in it as a whole
    invocation: a script is not a head word on any list, and asking whether a
    head only ever prints is the wrong question for one that runs gates.
    """
    if not words:
        return False
    if has_inline_script(words):
        return False
    if is_blind_run(words):
        return True
    head = os.path.basename(words[0])
    rest = words[1:]
    first = rest[0] if rest else ""
    if head == "pytest":
        return not any(w.startswith(PYTEST_WRITE_FLAGS) for w in rest)
    if head == "python" or head.startswith("python3"):
        if "-m" not in rest:
            return False
        after = rest.index("-m") + 1
        return after < len(rest) and rest[after] in PY_MODULES
    if head == "node":
        return "--test" in rest
    if head in ("npm", "pnpm", "yarn"):
        return first == "test"
    if head == "npx":
        return first in NPX_RUNNERS
    if head in ("cargo", "go"):
        return first == "test"
    return False


def is_object_restore(words: list[str]) -> bool:
    """`git restore --source <rev> -- <paths>` or `git checkout <rev> -- <paths>`.

    Both copy a named commit onto a path. Neither types content, so a lane that
    has git history can be reverted without going around its writer.
    """
    if len(words) < 4 or words[0] != "git":
        return False
    if words[1] == "restore":
        return "--source" in words[2:] or any(w.startswith("--source=") for w in words[2:])
    if words[1] == "checkout":
        return "--" in words[2:] and not words[2].startswith("-")
    return False


def words_of(segment: str) -> list[str]:
    try:
        return shlex.split(segment, comments=False, posix=True)
    except ValueError:
        return segment.split()


def _long_option(word: str, option: str, least: int) -> bool:
    """Would git read `word` as `--<option>`, spelled out or abbreviated?"""
    if not word.startswith("--"):
        return False
    name = word[2:].split("=", 1)[0]
    return len(name) >= least and option.startswith(name)


def _git_global_execs(word: str, value: str | None) -> bool:
    """Does this global option choose what git runs, rather than where?"""
    if word.split("=", 1)[0] in GIT_EXEC_GLOBALS:
        return True
    if word.startswith("-c") and not word.startswith("--"):
        setting = word[2:] or (value or "")
        return setting.split("=", 1)[0].startswith("alias.")
    return False


def git_parts(words: list[str]) -> tuple[str, list[str]] | None:
    """A git invocation split at its subcommand: `(subcommand, the words after)`.

    Global options come in front of the subcommand and five of them take a
    value, so `words[1]` is the subcommand in the plainest spelling only. Ask
    this split instead, never an index: it makes `git -C <dir> ls-files tests/`
    and `git ls-files tests/` one command to every caller, and a site that asks
    it cannot be broken by a spelling it did not think of.

    `None` is a git invocation with no subcommand to find -- a bare `git`, an
    option list that reaches no verb, or one carrying a `GIT_EXEC_GLOBALS`
    option or an alias definition, which choose what the verb runs. Callers read
    `None` as an unrecognized subcommand, and unrecognized denies.
    """
    i = 1
    while i < len(words):
        word = words[i]
        valued = word in GIT_VALUED_GLOBALS
        after = words[i + 1] if valued and i + 1 < len(words) else None
        if _git_global_execs(word, after):
            return None
        if valued:
            i += 2
            continue
        if word.startswith("-"):
            i += 1
            continue
        return word, words[i + 1 :]
    return None


def git_write_form(words: list[str]) -> bool:
    """Does this `GIT_NO_WORKTREE` stage carry a form that writes anyway?

    Git accepts a unique prefix of a long option, so an abbreviation is read as
    the option it could spell. That over-denies one a subcommand rejects, which
    is the safe direction. Every word after the subcommand is scanned, `--` and
    pattern arguments included, because a misread there under-denies.
    """
    parts = git_parts(words)
    if parts is None:
        return False
    sub, rest = parts
    if any(_long_option(w, GIT_OUTPUT, 3) for w in rest):
        return True
    if sub == "grep":
        for w in rest:
            if _long_option(w, GIT_GREP_PAGER, 2):
                return True
            if w.startswith("-") and not w.startswith("--") and "O" in w:
                return True
    return sub == "reflog" and any(w in GIT_REFLOG_WRITES for w in rest)


def segment_writes(segment: str, *, restore_ok: bool = True) -> bool:
    """Does this one pipeline stage change anything on disk?"""
    if redirect_writes(segment):
        return True
    words = command_words(words_of(segment))
    if not words:
        return False
    if words[0] in NO_COMMAND_HEADS:
        return False
    if is_runner(words):
        return False
    head = os.path.basename(words[0])
    if head == "git":
        if len(words) > 1 and words[1] in GIT_NO_WORKTREE:
            return git_write_form(words)
        return not (restore_ok and is_object_restore(words))
    return not reads_only(words)


#: a write stage whose targets this parser cannot name, and where the evidence
#: about them lives. `STAGE` is an interpreter handed a script: the paths are in
#: the script text, which is the stage and any heredoc body attached to it.
#: `STDIN` is `xargs`: the paths were produced upstream, so the evidence is the
#: whole command and not this stage.
STAGE, STDIN = "stage", "stdin"


def _option_value(word: str) -> list[str]:
    """The value half of a `--option=value` word, which is where a path can hide."""
    return [word.split("=", 1)[1]] if word.startswith("-") and "=" in word else []


def stage_targets(segment: str, body: str = "") -> tuple[list[str], str | None]:
    """What this stage writes to: (named targets, why the set is incomplete).

    A stage that writes only because of a redirection writes exactly where the
    redirection points, and nowhere else: `cat > drafts/x.txt <<EOF` writes
    `drafts/x.txt` whatever the prose in the body says, and
    `echo "tests/x" >> notes.txt` writes `notes.txt`. So for a head word that
    only reads, and for a git subcommand that never touches the working tree,
    the redirections are the whole answer.

    For a head word that writes, the arguments are the targets: `rm`, `cp`,
    `mv`, `sed -i` and `find -delete` all name what they act on, and a long
    option carries its value after an `=`.

    Two shapes name nothing this parser can read, and they return a reason
    instead of a complete list, so the caller can widen the evidence it looks
    at rather than treat an empty list as proof of innocence.
    """
    targets = redirect_targets(segment)
    words = command_words(words_of(segment))
    if not words or words[0] in NO_COMMAND_HEADS:
        return targets, None
    head = os.path.basename(words[0])
    git = git_parts(words) if head == "git" else None
    git_reader = git is not None and git[0] in GIT_NO_WORKTREE and not git_write_form(words)
    if is_runner(words) or reads_only(words) or git_reader:
        return targets, None
    if has_inline_script(words) or body:
        return targets, STAGE
    if head == "xargs":
        return targets, STDIN
    #: a git write acts on the words after its subcommand; the subcommand is
    #: the verb, not a path, and `git_parts` has already stepped over the
    #: global options in front of it, which name a directory and not a target
    for word in git[1] if git is not None else words[1:]:
        if word.startswith("-"):
            targets.extend(_option_value(word))
        else:
            targets.append(word)
    return targets, None


def command_writes(command: str, *, restore_ok: bool = True) -> bool:
    """Does any stage of this command change anything on disk?"""
    return any(segment_writes(s, restore_ok=restore_ok) for s in segments(command))


def lane_pattern(lane: str) -> re.Pattern[str]:
    """A regex matching a `<lane>` path token in a shell command, relative or absolute.

    The trailing slash is optional, because the lane is named without one every
    time a command takes the directory itself as an argument: `find tests
    -delete` and `rm -rf tests` write the whole lane and spell it `tests`. What
    follows the name must be a separator or the end of the command, so
    `tests_old.py` is not the lane.
    """
    return re.compile(r"(?:^|[\s\"'=(:])(?:[^\s\"']*/)?" + re.escape(lane) + r"(?:/|(?=[\s\"';|&)]|$))")


def bash_touches_lane(command: str, pattern: re.Pattern[str]) -> bool:
    return bool(pattern.search(command))


def cd_target(words: list[str]) -> str | None:
    """The directory a `cd` stage moves to, or None when the stage is not a `cd`."""
    if not words or os.path.basename(words[0]) != "cd":
        return None
    args = [w for w in words[1:] if not w.startswith("-")]
    return args[0] if args else ""


def _target_in_lane(target: str, here: str | None, pattern: re.Pattern[str]) -> bool:
    """Does one write target land in the lane, from the directory the walk is in?"""
    if pattern.search(target):
        return True
    if here and not os.path.isabs(target):
        return bool(pattern.search(os.path.normpath(os.path.join(here, target))))
    return False


def lane_write_in(command: str, pattern: re.Pattern[str], *, restore_ok: bool = True) -> bool:
    """Does any stage write to the lane, by naming it as a target or by standing in it?

    The question is asked of what each write stage writes *to*, never of the
    text of the stage: a lane path is a target when the command acts on it, and
    a string when the command is handed it. `grep -rn cite tests/` quoted in a
    heredoc, a lane path in a `for` list, and `echo "tests/x" >> notes.txt` all
    name a lane and write nowhere near it, and a text search cannot tell them
    from `rm tests/x`. `stage_targets` answers what the stage writes to, and
    only a stage that names no readable target falls back to its own text.

    The stages are walked in order carrying the directory a `cd` moved them
    to, because a command that never spells the lane can still write into it:
    `cd tests && rm t.py` names `tests` once, without the slash the lane
    pattern needs, and does its writing from inside. A relative target is
    resolved against that directory before it is tested.

    A `cd` whose target is absolute, `-`, `~...`, or absent moves somewhere
    this walk cannot follow, so it drops the tracking rather than guess.
    """
    here: str | None = ""
    for stage, body in segments_with_bodies(command):
        words = words_of(stage)
        target = cd_target(words)
        if target is not None:
            if here is None or target in ("", "-") or target.startswith(("/", "~")):
                here = None
            else:
                here = os.path.normpath(os.path.join(here, target))
            continue
        if not segment_writes(stage, restore_ok=restore_ok):
            continue
        targets, unknown = stage_targets(stage, body)
        if any(_target_in_lane(t, here, pattern) for t in targets):
            return True
        if unknown == STAGE and (pattern.search(stage) or pattern.search(body)):
            return True
        if unknown == STDIN and pattern.search(command):
            return True
        if unknown and here and pattern.search(here.rstrip("/") + "/"):
            return True
        if not targets and not unknown and here and pattern.search(here.rstrip("/") + "/"):
            #: a write that named nothing at all, made from inside the lane
            return True
    return False


def checkout_root(path: str) -> str | None:
    """The checkout (main or worktree) containing `path`, by walking up to a `.git`."""
    while True:
        if os.path.exists(os.path.join(path, ".git")):
            return path
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def root_by_name(path: str) -> str | None:
    """A checkout root read off the path alone, for trees that need not exist.

    `.claude/worktrees/<slug>-spec` and `-impl` are roots by construction; the
    directory holding `.claude/worktrees` is the main checkout.
    """
    parts = path.split(os.sep)
    for i in range(len(parts) - 1, 1, -1):
        if parts[i - 2] == ".claude" and parts[i - 1] == "worktrees":
            return os.sep.join(parts[: i + 1])
    return None


def split_root(target: str, cwd: str) -> tuple[str | None, str | None]:
    """(checkout root, path relative to it) for a write target, or (None, None)."""
    resolved = os.path.abspath(os.path.join(cwd, target))
    root = root_by_name(resolved) or checkout_root(os.path.dirname(resolved))
    if root is None:
        return None, None
    return root, os.path.relpath(resolved, root)


def under(rel: str, lane: str) -> bool:
    """Is this repo-relative path the lane directory or inside it?"""
    prefix = lane.replace("/", os.sep)
    return rel == prefix or rel.startswith(prefix + os.sep)


def path_in_lane(target: str, cwd: str, lane: str) -> bool:
    """Does the resolved target land inside a `<lane>` directory of any checkout?

    Falls back to a segment match when the path is in no checkout at all, so
    the lane holds before `git init` and outside a repo.
    """
    _, rel = split_root(target, cwd)
    if rel is not None and not rel.startswith(".."):
        return under(rel, lane)
    parts = os.path.abspath(os.path.join(cwd, target)).split(os.sep)
    lane_parts = lane.split("/")
    return any(parts[i : i + len(lane_parts)] == lane_parts for i in range(len(parts) - len(lane_parts) + 1))


def bypassed() -> bool:
    """Whether the owner started this session with the gauntlet off.

    `GAUNTLET=off claude`, and nothing else. The comparison is against the
    exact value `off` after strip and lowercase, so an unset, empty or
    misspelled variable leaves the gauntlet on, which is the safe direction.

    Read only at the top of a hook's `main()`, never inside a `_verdict()`: a
    self-test calls `_verdict()` directly, and a switch reachable from there
    would make the self-tests pass vacuously in a bypassed environment.
    """
    return os.environ.get("GAUNTLET", "").strip().lower() == "off"


def deny(reason: str) -> str:
    """The PreToolUse deny payload, as a JSON string."""
    import json

    return json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
    )


def command_of(tool_input: dict) -> str:
    """The `command` field of a tool input, as a string, whatever it holds.

    A hook reads this field and hands it to a classifier that splits it. The
    field is whatever the payload carried, so a number or a list there reaches
    the classifier as one and raises -- and a hook that raises exits non-zero,
    which is read as a denial of the call it was deciding. Anything that is not
    a string is no command, and an empty string is the shape the classifier
    already answers for.
    """
    command = (tool_input or {}).get("command")
    return command if isinstance(command, str) else ""


def cwd_of(payload: dict) -> str:
    """The `cwd` a payload names, as a path, or this process's own.

    Same boundary as `command_of`: the field is whatever the payload carried,
    and a hook that hands a number to `os.path` raises, which denies the call.
    """
    cwd = (payload or {}).get("cwd")
    return cwd if isinstance(cwd, str) and cwd else os.getcwd()


#: payloads a hook must answer without dying, each with the tool it names --
#: `None` for a payload that names nothing readable at all -- and whether the
#: fields a hook has to read are usable. Not a guess at what Claude Code sends:
#: each one is a shape some hook here has assumed away -- a missing field, a
#: field of the wrong type, a `cwd` naming a tree that was cut, a path that is
#: not a path. A hook that raises on any of them exits non-zero, and a non-zero
#: `PreToolUse` blocks the call; a hook that shrugs at one of the unusable ones
#: runs the call it was put there to decide.
HOSTILE_PAYLOADS = (
    ("", None, False),
    ("not json at all", None, False),
    ("null", None, False),
    ("[]", None, False),
    #: an object naming no tool names no call this hook guards
    ("{}", "", True),
    ('{"tool_name": "Bash"}', "Bash", False),
    ('{"tool_name": "Bash", "tool_input": null, "cwd": null}', "Bash", False),
    ('{"tool_name": "Bash", "tool_input": {"command": 17}, "cwd": 17}', "Bash", False),
    #: an empty command and an empty cwd are readable: the command runs nothing
    #: and the cwd falls back to this process's own, which is what `cwd_of` says
    ('{"tool_name": "Bash", "tool_input": {"command": ""}, "cwd": ""}', "Bash", True),
    ('{"tool_name": "Edit", "tool_input": {"file_path": null}}', "Edit", False),
    #: a NUL in a path is a string, so it is readable here and raises deeper in
    ('{"tool_name": "Edit", "tool_input": {"file_path": "\\u0000"}}', "Edit", True),
    (
        '{"tool_name": "Bash", "tool_input": {"command": "echo hi"},' ' "cwd": "/nonexistent-by-construction/deeper"}',
        "Bash",
        True,
    ),
    (
        '{"tool_name": "Bash", "tool_input": {"command": "echo hi"}, "cwd": "/etc/hostname"}',
        "Bash",
        True,
    ),
    (
        '{"tool_name": "Bash", "tool_input": {"command": "echo hi"},' ' "agent_type": 3, "cwd": "/"}',
        "Bash",
        False,
    ),
)

#: the field a call of this tool must carry as a string before a hook can
#: decide it. `Bash` carries the command; a write carries its target.
REQUIRED_FIELD = {
    "Write": "file_path",
    "Edit": "file_path",
    "NotebookEdit": "notebook_path",
    "Read": "file_path",
    "Bash": "command",
}

#: a field a call may omit, but may not carry as something other than a string
OPTIONAL_FIELD = {"Grep": "path", "Glob": "path"}


def payload_fault(name: str, tool_input, payload, guarded: tuple[str, ...]) -> str | None:
    """Why this hook cannot decide the call it was handed, or None to decide it.

    A guard reads three things: which tool, what it names, and who is running
    it. Where one of them is missing or is not the type it has to be, the hook
    has not been handed a call it can evaluate -- and the answer to a call a
    guard cannot evaluate is no, never silence. Coercing the field to a benign
    default instead (an absent command, an empty path, an anonymous agent) is
    the shape that lets exactly the malformed call through the gate.

    Only a call of a tool in `guarded` is faulted. Every other tool is somebody
    else's to decide, and a hook that refuses a call outside its own subject
    would deny half the session over a field it never reads.
    """
    if name not in guarded:
        return None
    for field in ("cwd", "agent_type"):
        value = (payload or {}).get(field)
        if value is not None and not isinstance(value, str):
            return f"the payload carries {field} as {type(value).__name__}, not a string"
    if not isinstance(tool_input, dict):
        return f"the {name} call carries no tool_input object"
    required = REQUIRED_FIELD.get(name)
    if required is not None:
        value = tool_input.get(required)
        if not isinstance(value, str):
            return f"the {name} call carries {required} as {type(value).__name__}, not a string"
        if not value and name != "Bash":
            return f"the {name} call carries an empty {required}"
    optional = OPTIONAL_FIELD.get(name)
    if optional is not None:
        value = tool_input.get(optional)
        if value is not None and not isinstance(value, str):
            return f"the {name} call carries {optional} as {type(value).__name__}, not a string"
    return None


def undecidable(why: str) -> str:
    """The refusal a hook gives for a call it could not decide.

    Names the hook, so the denial that reaches the agent says which gate spoke
    and what it could not read, rather than arriving as an unexplained no.
    """
    hook = os.path.basename(sys.argv[0]) or "a gauntlet hook"
    return (
        f"{hook} could not decide this call, so it refuses it: {why}. A gate that "
        "cannot read the call it was handed does not let the call through -- the "
        "malformed payload is the one that most needs deciding. Reissue the call "
        f"with the field it is missing. (hooks/{hook})"
    )


def is_denial(answer: str) -> bool:
    """Whether a hook's stdout is a `PreToolUse` denial."""
    import json as _json

    try:
        parsed = _json.loads(answer)
    except ValueError:
        return False
    if not isinstance(parsed, dict):
        return False
    specific = parsed.get("hookSpecificOutput")
    return isinstance(specific, dict) and specific.get("permissionDecision") == "deny"


def survives_hostile_payloads(
    hook_path: str,
    *argv: str,
    guards: tuple[str, ...] = ("Write", "Edit", "NotebookEdit", "Bash"),
    refuses_undecidable: bool = True,
) -> bool:
    """That this hook answers every `HOSTILE_PAYLOADS` shape, and answers no.

    Two failures, not one. A hook decides a tool call, so its own crash is a
    denial of whatever it was deciding: it is run the way Claude Code runs it,
    one JSON object on stdin, and must exit 0 and write either nothing or a
    parsable answer, whatever it is handed. And a hook that stays alive by
    treating every payload it cannot read as an allow has moved the defect
    rather than fixed it, so each payload whose fields this hook needs and
    cannot read must come back a denial. `guards` is the set of tools this hook
    decides; a payload naming any other tool is not its call to refuse.

    `refuses_undecidable` is false for an entry point that decides no tool call
    -- a `Stop` gate reads no payload and has no permission to withhold -- and
    there the older contract is the whole contract: stay alive, answer parsably.

    `GAUNTLET` is cleared for the run. Under `GAUNTLET=off` a hook returns at
    its first line, and every payload would pass without touching the code the
    check exists to exercise.
    """
    import json as _json
    import subprocess

    environment = dict(os.environ)
    environment.pop("GAUNTLET", None)
    for payload, tool, usable in HOSTILE_PAYLOADS:
        done = subprocess.run(
            [sys.executable, hook_path, *argv],
            input=payload,
            capture_output=True,
            text=True,
            env=environment,
            timeout=60,
        )
        if done.returncode != 0:
            return False
        out = done.stdout.strip()
        if out:
            try:
                _json.loads(out)
            except ValueError:
                return False
        if not refuses_undecidable:
            continue
        #: a payload naming no readable tool at all is undecidable for every
        #: hook; one naming a guarded tool is undecidable when its fields are not
        if tool is None or (tool in guards and not usable):
            if not is_denial(out):
                return False
    return True


# --- the shape a lane hook is ------------------------------------------------
#
# Five hooks here guard a directory that one named agent writes. They differ in
# the lane, the agent and the prose of the refusal; everything around those
# three was the same text copied five times, which is the shape where one hook
# gets a fix and four keep the defect. The dispatch, the entry point and the
# denial sentence live here now, and a lane hook is its constants plus whatever
# it does that the others do not.

#: tools that write a file. `NotebookEdit` names its target `notebook_path`.
WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")


def write_target(tool_input: dict) -> str:
    """The path a write tool names, or the empty string for no target."""
    tool_input = tool_input or {}
    return tool_input.get("file_path") or tool_input.get("notebook_path") or ""


def dispatch(
    name: str,
    tool_input: dict,
    payload: dict,
    *,
    on_write,
    on_bash,
    on_read=None,
    read_tools: tuple[str, ...] = (),
) -> str | None:
    """Route one tool call to the handler for its kind; None lets it through.

    `on_write(target, cwd, agent)` is called only for a write that names a
    target, since a write with no path denies nothing. `on_read(tool_input,
    cwd, agent)` sees the whole input, because a read names its target under
    three different keys. `on_bash(command, agent)` takes the agent whether or
    not the lane cares who ran the command, so that every lane hook hands this
    function the same two-argument callable.
    """
    cwd = cwd_of(payload)
    agent = (payload or {}).get("agent_type") or ""
    if name in WRITE_TOOLS:
        target = write_target(tool_input)
        return on_write(target, cwd, agent) if target else None
    if on_read is not None and name in read_tools:
        return on_read(tool_input, cwd, agent)
    if name == "Bash":
        return on_bash(command_of(tool_input), agent)
    return None


def lane_denial(lane: str, noun: str, lane_msg: str, *, restore: bool = True) -> str:
    """The refusal a shell write into `lane` gets.

    `restore` is false for a lane with no restore escape, where the sentence
    ends at the reason.
    """
    denial = f"A shell write naming a {lane}/ path is denied: " + lane_msg
    if not restore:
        return denial
    return (
        denial + f" Restoring {noun} from a git object is the one shell shape "
        f"that passes: `git restore --source <rev> -- {lane}/<file>`."
    )


def sole_writer_lane(lane: str, writer: str, lane_msg: str, bash_msg: str):
    """The verdict function of a lane one named agent writes and nobody else.

    Returns a `_verdict(name, tool_input, payload)`. A write whose target is in
    the lane passes for `writer` and is refused with `lane_msg` for every other
    hand, the main agent included; a shell command that writes into the lane is
    refused with `bash_msg`; everything else passes.
    """
    pattern = lane_pattern(lane)

    def on_write(target: str, cwd: str, agent: str) -> str | None:
        if not path_in_lane(target, cwd, lane):
            return None
        return None if agent == writer else lane_msg

    def on_bash(command: str, agent: str) -> str | None:
        return bash_msg if lane_write_in(command, pattern) else None

    def verdict(name: str, tool_input: dict, payload: dict) -> str | None:
        return dispatch(name, tool_input, payload, on_write=on_write, on_bash=on_bash)

    return verdict


def read_payload(guards: tuple[str, ...]) -> tuple[dict | None, str | None]:
    """One payload from stdin as `(payload, refusal)`; exactly one is not None.

    Every way the payload can fail to be a call this hook can decide ends in a
    refusal, never in silence. The three the old entry point swallowed -- stdin
    that will not read, text that is not JSON, JSON that is not an object --
    are each a case where the hook has no idea what it was asked to decide, and
    no idea is not consent.
    """
    try:
        raw = sys.stdin.read()
    except OSError as exc:
        return None, undecidable(f"its payload could not be read from stdin ({exc})")
    try:
        data = json.loads(raw)
    except ValueError:
        return None, undecidable("its payload is not JSON")
    if not isinstance(data, dict):
        return None, undecidable("its payload is not a JSON object")
    if not isinstance(data.get("tool_name", ""), str):
        return None, undecidable("its payload carries tool_name as something other than a string")
    fault = payload_fault(data.get("tool_name", ""), data.get("tool_input"), data, guards)
    return (None, undecidable(fault)) if fault is not None else (data, None)


def hook_main(verdict, *, guards: tuple[str, ...] = WRITE_TOOLS + ("Bash",)) -> None:
    """Read one payload from stdin and print a denial if `verdict` names one.

    `guards` is the set of tools this hook decides, and it is what makes a
    malformed payload refusable: a call of a tool outside the set is not this
    hook's to refuse however broken it is.

    A `verdict` that raises is a denial too. It is the same failure as a
    payload that will not parse -- the hook does not know whether the call is
    allowed -- and the same answer follows, with the exception named in it so
    the defect is visible rather than absorbed. `except Exception` is wide on
    purpose: what is caught is not a known-harmless class but every way this
    hook can fail, and none of them ends in the call being run.

    The switch is read here and nowhere else: a self-test calls `verdict`
    directly, so a bypass reachable from inside it would make every self-test
    pass vacuously under `GAUNTLET=off`.
    """
    if bypassed():
        return  # GAUNTLET=off: the owner's switch, read at the entry point only
    data, refusal = read_payload(guards)
    if refusal is not None:
        print(deny(refusal))
        return
    try:
        reason = verdict(data.get("tool_name", ""), data.get("tool_input") or {}, data)
    except Exception as exc:  # noqa: BLE001 -- see the docstring: a crash is a denial
        print(deny(undecidable(f"deciding it raised {type(exc).__name__}: {exc}")))
        return
    if reason is not None:
        print(deny(reason))


def answer_main(answer_of, *, guards: tuple[str, ...] = ("Bash",)) -> None:
    """`hook_main` for a hook whose answer is not a denial.

    `bwrap-wrap.py` rewrites the command rather than refusing it, so its answer
    is a whole `hookSpecificOutput` object. Every failure path is the same as
    `hook_main`'s and ends the same way: a hook that cannot build the sandbox a
    command was going to run inside refuses the command, because the fallback
    it would otherwise take is running that command unsandboxed.
    """
    if bypassed():
        return  # GAUNTLET=off: the owner's switch, read at the entry point only
    data, refusal = read_payload(guards)
    if refusal is not None:
        print(deny(refusal))
        return
    try:
        answer = answer_of(data)
    except Exception as exc:  # noqa: BLE001 -- see `hook_main`: a crash is a denial
        print(deny(undecidable(f"answering it raised {type(exc).__name__}: {exc}")))
        return
    if answer is not None:
        print(json.dumps(answer))


def entry(self_test_fn, main_fn) -> None:
    """The `__main__` of a hook with one gate mode and one wire mode."""
    sys.exit(self_test_fn()) if "--self-test" in sys.argv else main_fn()


# --- the shape a self-test is ------------------------------------------------


def denied(verdict: str | None) -> bool:
    """That a verdict refused the call: a refusal is its own reason."""
    return isinstance(verdict, str)


def allowed(verdict: str | None) -> bool:
    """That a verdict let the call through."""
    return verdict is None


def probe(verdict, root: str, tool: str, key: str = "file_path", *, agent: str | None = None):
    """A closure that calls `verdict` for one tool the way the wire does.

    `key` is the field that tool carries its target in. `agent` is the default
    `agent_type` the closure sends, overridden per call; `None` is the main
    agent, whose payload carries no such key at all.
    """

    def call(value, who: str | None = agent) -> str | None:
        payload = {"cwd": root}
        if who is not None:
            payload["agent_type"] = who
        return verdict(tool, {key: value}, payload)

    return call


#: one of the three default directory names as a whole path segment, for
#: `rebased`. The bounds are not `\b`: a name is a segment when nothing joins it
#: on either side, and `\b` would take the `gauntlet` of `gauntlet-arbiter` and
#: rename the agent. A trailing `/` is left to the text, so `find tests -delete`
#: and `cd tests && rm t.py` -- a lane named with no slash at all -- respell too.
_DEFAULT_SEGMENT = re.compile(r"(?<![\w.-])(" + "|".join(sorted(set(DEFAULT_DIRS.values()))) + r")(?![\w.-])")


def respell(target: str) -> str:
    """One self-test path or command, at the configured directories.

    Exactly one pass, and never applied twice to the same string: the three
    names are disjoint from each other but a configured name may still contain
    a default one as a segment -- `gauntlet_dir` of `work/tests` is a legal set
    beside `tests_dir` -- and a second pass would rewrite what the first wrote.
    """
    by_default = dict(zip(DEFAULT_DIRS.values(), dirs().values()))
    if all(default == configured for default, configured in by_default.items()):
        return target
    return _DEFAULT_SEGMENT.sub(lambda m: by_default[m.group(1)], target)


def rebased(one_probe):
    """A probe that respells the kit's default directories at the configured ones.

    Every self-test writes its paths at `tests/`, `docs/` and `gauntlet/`, which
    is what the kit ships and what the prose around each line says. Under a
    project that moved one of them those literals name nothing any hook guards,
    so the lines would pass by naming paths outside the lane and prove nothing.
    Rewriting the segment here means one set of lines holds at any base, and the
    lane each line is about is the lane the hook actually resolved.

    One pass, not three: with `tests_dir` at `docs` and `docs_dir` elsewhere,
    replacing one name after another would rewrite what the previous pass had
    just written. The names are disjoint, so a single alternation is exact.
    """

    def at_configured_dirs(target: str, *rest):
        return one_probe(respell(target), *rest)

    return at_configured_dirs


def probes(verdict, root: str = "/repo", *, agent: str | None = None):
    """The `(write, bash)` pair every lane self-test drives its lane through."""
    return (
        rebased(probe(verdict, root, "Edit", agent=agent)),
        rebased(probe(verdict, root, "Bash", "command", agent=agent)),
    )


def report(lines: dict) -> int:
    """Print one PASS or FAIL per spec line; 0 if every line held."""
    for label, ok in lines.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(lines.values()) else 1


if __name__ == "__main__":
    #: `shell_shapes.py --config tests_dir` prints the one config value for a
    #: shell script; `scripts/blind.sh` and `scripts/pair.sh` read it through
    #: here so one reader serves the hooks and the scripts alike
    if len(sys.argv) == 3 and sys.argv[1] == "--config":
        sys.stdout.write("".join(line + "\n" for line in config_lines(sys.argv[2])))
        sys.exit(0)
    sys.stderr.write("usage: shell_shapes.py --config <key>\n")
    sys.exit(2)
