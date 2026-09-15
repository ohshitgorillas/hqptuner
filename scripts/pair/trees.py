#!/usr/bin/env python3
"""The two worktrees a block is written in, and what each of them wrote.

A pair is two checkouts off one commit: the spec tree, where the blind writer
writes tests and nothing else, and the implementation tree, where the main
agent writes everything but tests. They cannot share a tree -- a red run in a
tree that already holds the implementation proves nothing -- and the disjoint
lanes are what make the combine in `converge.py` conflict-free by construction.

Everything here prints to stderr. The stdout of `scripts/pair.sh` is contract,
documented in `docs/agents.md`, and a library that printed to it would be
writing that contract from underneath the one file that owns it.
"""

from __future__ import annotations

import os
import subprocess
import sys

_HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".claude", "hooks")
sys.path.insert(0, _HOOKS)

try:
    import shell_shapes as sh  # noqa: E402
except ImportError:  # pragma: no cover - a checkout missing half the kit
    sys.exit(f"pair: no shell_shapes.py in {_HOOKS}: scripts/ ships with .claude/hooks/")


def _root() -> str:
    """The primary checkout, found from this file rather than from the caller's cwd."""
    here = os.path.dirname(os.path.abspath(__file__))
    done = subprocess.run(
        ("git", "-C", here, "rev-parse", "--show-toplevel"),
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        sys.exit("pair: not inside a git checkout")
    return done.stdout.strip()


ROOT = _root()

#: every directory the kit names comes from `blind-reads.json`, through the
#: reader the hooks use: the lane this script diffs is the lane `tests-lane.py`
#: guards, and the two it reads are the lanes `specs-lane.py` and
#: `reviews-lane.py` hold. The branch and the gate come from the same file.
TESTS = sh.tests_dir()
SPECS = sh.specs_lane()
REVIEWS = sh.reviews_lane()
#: the base the chain's own run artifacts sit under, beside the four lanes
GAUNTLET = sh.gauntlet_dir()
TARGET = sh.target_branch()
GATE = sh.gate_command()

WORKTREES = ".claude/worktrees"
STATE = WORKTREES + "/.pair-state"
LOCK = WORKTREES + "/.pair.lock"

#: linked rather than installed, and never committed: a fresh worktree has no
#: interpreter of its own, and borrowing the primary checkout's is enough
#: because both are read-only in use
TOOLING = (".venv", "node_modules")


def note(message: str) -> None:
    """One progress line, on stderr, where the stdout contract cannot reach it."""
    sys.stderr.write(message + "\n")


def die(message: str) -> "None":
    sys.stderr.write(message + "\n")
    raise SystemExit(2)


def path(*parts: str) -> str:
    return os.path.join(ROOT, *parts)


def spec_tree(slug: str) -> str:
    return WORKTREES + "/" + slug + "-spec"


def impl_tree(slug: str) -> str:
    return WORKTREES + "/" + slug + "-impl"


def spec_branch(slug: str) -> str:
    return "spec/" + slug


def impl_branch(slug: str) -> str:
    return "impl/" + slug


def git(*args: str, tree: str | None = None, check: bool = True) -> str:
    """One git command, in the primary checkout unless `tree` names another."""
    where = path(tree) if tree else ROOT
    done = subprocess.run(
        ("git", "-C", where, *args), capture_output=True, text=True, check=False
    )
    if check and done.returncode != 0:
        die("pair: git " + " ".join(args) + " failed:\n" + done.stderr.rstrip())
    return done.stdout.strip()


def git_out(*args: str, tree: str | None = None) -> str:
    """The same, with the output left exactly as git wrote it.

    A diff is evidence a blind agent reads: stripping its edges would be this
    script editing what the reviewer is shown.
    """
    where = path(tree) if tree else ROOT
    done = subprocess.run(
        ("git", "-C", where, *args), capture_output=True, text=True, check=False
    )
    return done.stdout


def git_ok(*args: str, tree: str | None = None) -> bool:
    """Whether a git command succeeded, with its output discarded."""
    where = path(tree) if tree else ROOT
    return (
        subprocess.run(
            ("git", "-C", where, *args), capture_output=True, text=True, check=False
        ).returncode
        == 0
    )


def exists(rev: str) -> bool:
    return git_ok("rev-parse", "-q", "--verify", rev)


def link_tooling(tree: str) -> None:
    """Borrow the primary checkout's interpreters, so a gate can run in the tree."""
    for dep in TOOLING:
        source = path(dep)
        target = path(tree, dep)
        if os.path.exists(source) and not os.path.lexists(target):
            os.symlink(source, target)
    _exclude_tooling(tree)


def _exclude_tooling(tree: str) -> None:
    """Ignore the links in this worktree alone, through its own exclude file.

    A project spells its interpreter `.venv/` in `.gitignore`, and a pattern
    with a trailing slash matches a directory but not a symlink to one. So
    without this the links read as untracked work: `git add -A` in the tree
    would commit them, and `git worktree remove` would refuse the tree they sit
    in. The exclude file is the one place to say it that no project's
    `.gitignore` has to be edited for. It lives in the common directory, which
    every worktree of the checkout reads, and it is never committed.
    """
    common = git(
        "rev-parse", "--path-format=absolute", "--git-common-dir", tree=tree, check=False
    )
    if not common:
        return
    exclude = os.path.join(common, "info", "exclude")
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    wanted = ["/" + dep for dep in TOOLING]
    held = []
    if os.path.exists(exclude):
        with open(exclude, encoding="utf-8") as handle:
            held = handle.read().splitlines()
    missing = [line for line in wanted if line not in held]
    if not missing:
        return
    with open(exclude, "a", encoding="utf-8") as handle:
        handle.write("".join(line + "\n" for line in missing))


def unlink_tooling(tree: str) -> None:
    """Take the links back out.

    `git worktree remove` refuses a tree carrying untracked files, and a symlink
    to a directory is not matched by the trailing-slash `.gitignore` entry that
    covers the directory itself. So the links the script put there would hold
    the tree it is trying to remove.
    """
    for dep in TOOLING:
        target = path(tree, dep)
        if os.path.islink(target):
            os.unlink(target)


def in_tree(tree: str, argv: list[str]) -> int:
    """Run a command inside a tree, with that tree ahead of any installed copy.

    The borrowed `.venv` points at the primary checkout, so without `PYTHONPATH`
    a worktree's suite silently tests the wrong code.
    """
    where = path(tree)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = where
    #: the child's own stdout goes to stderr with everything else here. A gate
    #: prints its report, and a report printed on stdout would land in the
    #: middle of a contract line the reviewer's brief is read from.
    sys.stdout.flush()
    done = subprocess.run(
        argv, cwd=where, env=environment, stdout=sys.stderr, stderr=sys.stderr, check=False
    )
    return done.returncode


def capture_in_tree(tree: str, argv: list[str]) -> str:
    """The same run, with its output captured rather than inherited."""
    where = path(tree)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = where
    done = subprocess.run(
        argv, cwd=where, env=environment, capture_output=True, text=True, check=False
    )
    return done.stdout + done.stderr


def dirty_files(tree: str) -> list[str]:
    """Uncommitted work in a tree: staged, unstaged and untracked alike.

    Minus the links `link_tooling` put there, which git reports as untracked for
    the reason `unlink_tooling` gives. Counting them would fail the lane check on
    the script's own scaffolding, every run.
    """
    named = set()
    for line in git("diff", "--name-only", "HEAD", tree=tree).splitlines():
        named.add(line.strip())
    for line in git("ls-files", "--others", "--exclude-standard", tree=tree).splitlines():
        named.add(line.strip())
    return sorted(name for name in named if name and name not in TOOLING)


def tree_files(tree: str) -> list[str]:
    """Everything this tree wrote, which is not everything it contains.

    The combine merges the implementation branch into the spec tree, so once it
    has run the spec branch holds implementation relative to the commit the pair
    was cut at. Diffing the recorded base would make the lane check reject the
    script's own combine and wedge every re-run after a red gate.

    So enumerate the tree's own contribution: the files its non-merge commits
    touched along its first-parent chain, plus whatever is uncommitted now. A
    combine is a merge commit, so it is skipped and everything that arrived
    through it is skipped with it, while a file the writer really did author
    outside its lane sits on a plain commit and still shows.

    The chain starts at the merge base with the target branch rather than at the
    recorded base, so a branch already rebased onto a moved target is measured
    from where it now sits and the target's own commits never read as this
    tree's work.
    """
    start = git("merge-base", TARGET, "HEAD", tree=tree)
    named = set(dirty_files(tree))
    listed = git(
        "log",
        "--first-parent",
        "--no-merges",
        "--name-only",
        "--pretty=format:",
        start + "..HEAD",
        tree=tree,
    )
    for line in listed.splitlines():
        name = line.strip()
        if name and name not in TOOLING:
            named.add(name)
    return sorted(named)


def lane_check(tree: str, lane: str) -> bool:
    """The disjoint-path rule, enforced rather than trusted.

    `lane` is `spec`, whose tree writes the tests directory and nothing else, or
    `impl`, whose tree writes everything but it.
    """
    prefix = TESTS + "/"
    written = tree_files(tree)
    if lane == "spec":
        outside = [name for name in written if not name.startswith(prefix)]
    else:
        outside = [name for name in written if name.startswith(prefix)]
    if not outside:
        return True
    note("  " + lane + " tree wrote outside its lane:")
    for name in outside:
        note("    " + name)
    return False


def commit_tree(tree: str, message: str) -> bool:
    """Commit whatever a tree is holding, or say there was nothing to commit.

    It asks `dirty_files`, not `git status`: the tooling links are not work, and
    on a re-run the previous run's commits are already in, where a `git commit`
    with nothing staged would end the run.
    """
    named = dirty_files(tree)
    if not named:
        note("  " + tree + ": nothing to commit")
        return False
    #: the files by name rather than `-- .`: a `.gitignore` entry spelled with a
    #: trailing slash does not match a symlink to that directory, so `add -A`
    #: over the whole tree would stage the tooling links `link_tooling` made
    git("add", "-A", "--", *named, tree=tree)
    if in_tree(tree, ["git", "commit", "-q", "-m", message]) != 0:
        die("pair: the commit in " + tree + " failed")
    note("  " + tree + ": committed as " + message)
    return True


def record_base(slug: str, commit: str) -> None:
    os.makedirs(path(STATE), exist_ok=True)
    with open(path(STATE, slug + ".base"), "w", encoding="utf-8") as handle:
        handle.write(commit + "\n")


def read_base(slug: str) -> str | None:
    try:
        with open(path(STATE, slug + ".base"), encoding="utf-8") as handle:
            return handle.read().strip() or None
    except OSError:
        return None


def forget_base(slug: str) -> None:
    try:
        os.unlink(path(STATE, slug + ".base"))
    except OSError:
        pass


def open_pairs() -> list[str]:
    """The slugs with a recorded base, oldest name first."""
    try:
        names = os.listdir(path(STATE))
    except OSError:
        return []
    return sorted(name[: -len(".base")] for name in names if name.endswith(".base"))
