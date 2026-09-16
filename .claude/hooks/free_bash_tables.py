#!/usr/bin/env python3
"""The closed lists the free-Bash allowlist reads — names, flags, targets.

free_bash.py holds the verdicts; this holds the tables they consult. Every
entry is a name or a flag a verdict tests membership in, so a table that grows
does not lengthen the file that decides anything.

A name is on a list because it reads and reports and has no mutating form worth
the parser; where a command has both, the decision is a function in free_bash.py
and only the mutating half's flags live here.
"""

import re

# verifiers — meaningful only as a pipeline head.
# lint-js / test-js / check-css are this repo's JS-side gates (make check =
# lint lint-js test test-js); they verify and mutate nothing.
FREE_MAKE_TARGETS = {
    "check",
    "test",
    "test-live",
    "lint",
    "typecheck",
    "fmt-check",
    "format-check",
    "lint-js",
    "test-js",
    "check-css",
}
FREE_PY_CMDS = {"pytest", "py.test", "unittest", "mypy", "xenon", "flake8", "pyright", "pylint"}
# readers — read-only text tools, valid as a pipe head OR a downstream stage.
# sed / find / sort are read-only only with restrictions, handled specially.
READERS = {
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "stat",
    "file",
    "diff",
    "comm",
    "cut",
    "uniq",
    "nl",
    "column",
    "tr",
    "fold",
    "rev",
    "tac",
    "less",
    "more",
    "jq",
    "which",
    "whereis",
    "echo",
    "printf",
    # checksums: read a file, print a digest, and have no output flag to
    # guard. Verifying a file is unchanged should not cost a report.
    "sha256sum",
    "md5sum",
    "b2sum",
    "cksum",
}
# rpm/dpkg mutating flags — presence disqualifies the query
RPM_BAD = {
    "-i",
    "-U",
    "-F",
    "-e",
    "--install",
    "--upgrade",
    "--freshen",
    "--erase",
    "--import",
    "--rebuilddb",
    "--setperms",
    "--setugids",
}
# `find` actions that execute or mutate
FIND_BAD = {"-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"}
# git subcommands that only read history/state. Deliberately absent: branch,
# tag, stash, reflog, notes, config — each has a mutating flag form, and
# telling those apart is not worth the parser.
GIT_READ_SUBCMDS = {
    "log",
    "show",
    "diff",
    "status",
    "blame",
    "shortlog",
    "rev-parse",
    "rev-list",
    "ls-files",
    "ls-tree",
    "cat-file",
    "describe",
    "name-rev",
    "whatchanged",
    "check-ignore",
}
# git global options that cannot change WHICH code runs. `-c k=v` is absent on
# purpose: it can define an alias or a textconv filter that executes.
GIT_GLOBAL_FLAGS = {"--no-pager", "-P", "--literal-pathspecs", "--no-replace-objects", "--bare"}
# `git branch` flags that write a ref instead of listing them
GIT_BRANCH_BAD = {
    "-d",
    "-D",
    "-m",
    "-M",
    "-c",
    "-C",
    "-f",
    "--delete",
    "--move",
    "--copy",
    "--force",
    "--set-upstream-to",
    "-u",
    "--unset-upstream",
    "--edit-description",
}
# node flags that hand it a program on the command line instead of a test file
NODE_BAD = {"-e", "--eval", "-p", "--print", "-i", "--interactive"}
# JS-side verifiers, reached through `npx`. They read and report; the flags that
# would make them rewrite (--fix, --write) are in free_bash_lex.BANNED_SUBSTR already.
FREE_JS_CMDS = {"eslint", "knip", "jscpd", "prettier"}
# `set` flags that only change shell options — `set -a` before sourcing creds
SET_FLAGS = re.compile(r"^[-+][aeux]$")
# The one file a `source` may name: the gitignored dev credentials at repo root.
SOURCEABLE = "hqpcreds"
# the one script a bare `python` head may run free: a gate, by relative path
GATE_SCRIPT = re.compile(r"^scripts/gates/check_[a-z0-9_]+\.py$")
# `scripts/gate.sh`, in this checkout or in a worktree's copy of it. It runs the
# command it is given and adds a log file, so it is free exactly when that
# command is free: the prefix comes off and the allowlist judges what is left.
GATE_WRAPPER = re.compile(r"^(?:\./)?(?:[\w./-]*/)?scripts/gate\.sh$")
