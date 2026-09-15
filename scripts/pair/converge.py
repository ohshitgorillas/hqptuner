#!/usr/bin/env python3
"""Converging a pair: rebase, combine, gate, land.

`merge` touches the target branch only at the very end, and in this order:

    1. lane check   the spec tree confined to the tests directory, the
                    implementation tree kept out of it
    2. commit       both trees
    3. rebase       both branches onto the target branch, if it moved under them
    4. combine      the implementation branch merged into the SPEC tree
    5. gate         the configured gate command in that combined tree; a red
                    gate stops here and the target branch never sees it
    6. land         the target branch fast-forwarded to it, branches and trees
                    removed

Steps 3 to 6 hold a lock, so two sessions converging at once queue instead of
racing the branch tip. Every land is `--ff-only`; nothing is ever force-pushed.

The branch and the gate are read from `.claude/hooks/blind-reads.json`, like
every directory the kit names. Neither is a literal here.
"""

from __future__ import annotations

import fcntl
import os
import shlex
import subprocess

import trees
from trees import GATE, TARGET, die, exists, git, git_ok, note, path


class Lock:
    """`flock` on `.claude/worktrees/.pair.lock`, held for the whole converge."""

    def __init__(self) -> None:
        self.handle = None

    def __enter__(self) -> "Lock":
        os.makedirs(path(trees.WORKTREES), exist_ok=True)
        self.handle = open(path(trees.LOCK), "w", encoding="utf-8")
        note("  waiting for the pair lock...")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc) -> None:
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


def rebase_if_moved(slug: str, has_impl: bool) -> None:
    """Replay both branches onto the target branch, where it moved under them.

    "Moved" is ancestry, not the recorded base, for the same reason
    `tree_files` measures from a merge base. A pair cut while another session
    was landing sits on a tip ahead of its own base file with nothing to
    rebase; measured against that file it reads as moved, and the guard below
    would then refuse a rebase that was never needed.
    """
    spec = trees.spec_tree(slug)
    impl = trees.impl_tree(slug)
    tip = git("rev-parse", TARGET)
    points = [git("merge-base", TARGET, "HEAD", tree=spec)]
    if has_impl:
        points.append(git("merge-base", TARGET, "HEAD", tree=impl))
    if all(point == tip for point in points):
        note("  " + TARGET + " has not moved under " + slug)
        return

    moved = git("rev-list", "--count", points[0] + ".." + tip)
    note("  " + TARGET + " moved " + moved + " commit(s) under " + slug + " -- rebasing")
    #: a re-run after a red gate reaches here with step 4's combine already on
    #: the spec branch. A plain rebase drops merge commits and replays their
    #: side, so it would flatten that combine and duplicate the implementation
    #: commits the other rebase is about to rewrite. Stop instead of corrupting.
    if git("rev-list", "--merges", points[0] + "..HEAD", tree=spec):
        die(
            "pair: " + TARGET + " moved after " + slug + " was already combined;"
            " rebasing " + trees.spec_branch(slug) + " would flatten that merge and"
            " duplicate " + trees.impl_branch(slug) + "'s commits. Rebase it by hand"
            " in " + spec + ", keeping the combine, and rerun."
        )
    if has_impl and not git_ok("rebase", "--quiet", TARGET, tree=impl):
        die(
            "pair: " + trees.impl_branch(slug) + " does not rebase onto " + TARGET
            + " cleanly -- resolve it in " + impl + " and rerun."
        )
    if not git_ok("rebase", "--quiet", TARGET, tree=spec):
        die(
            "pair: " + trees.spec_branch(slug) + " does not rebase onto " + TARGET
            + " cleanly -- resolve it in " + spec + " and rerun."
        )


def combine(slug: str) -> None:
    """Merge the implementation branch into the spec tree.

    An implementation branch already an ancestor of the spec branch is a combine
    that has run: merging again is a no-op, but a second `--no-ff` merge commit
    over one that already landed would flatten nothing and prove nothing, so it
    is refused rather than repeated.
    """
    spec = trees.spec_tree(slug)
    branch = trees.impl_branch(slug)
    if git("rev-list", "--count", TARGET + ".." + branch) == "0":
        note("  " + branch + " carries no commit of its own; nothing to combine")
        return
    if git_ok("merge-base", "--is-ancestor", branch, "HEAD", tree=spec):
        die(
            "pair: " + branch + " is already combined into " + trees.spec_branch(slug)
            + " -- rerun the gate in " + spec + " rather than combining twice."
        )
    if not git_ok("merge", "--no-ff", "--no-edit", branch, tree=spec):
        die(
            "pair: merging " + branch + " into " + trees.spec_branch(slug)
            + " conflicted -- the lanes should have prevented this; resolve in "
            + spec + "."
        )
    note("  " + spec + " now holds the tests and the implementation")


def gate(slug: str) -> bool:
    """Run the configured gate command in the combined tree.

    `shlex.split`, not a shell: the command is configuration, and a shell would
    make a second command smuggled into that value run here.
    """
    argv = shlex.split(GATE)
    if not argv:
        die("pair: gate_command in .claude/hooks/blind-reads.json is empty")
    note("  gate: " + GATE)
    return trees.in_tree(trees.spec_tree(slug), argv) == 0


def land(slug: str) -> str:
    """Fast-forward the target branch onto the spec branch. Returns the commit."""
    branch = trees.spec_branch(slug)
    on = git("rev-parse", "--abbrev-ref", "HEAD")
    if on != TARGET:
        die(
            "pair: the primary checkout is on " + on + ", and a pair lands on "
            + TARGET + " -- check out " + TARGET + " and rerun."
        )
    if not git_ok("merge", "--ff-only", branch):
        die(
            "pair: " + TARGET + " will not fast-forward to " + branch
            + " -- the primary checkout may carry local changes over the same files."
        )
    return git("rev-parse", "HEAD")


def cleanup(slug: str, has_impl: bool) -> None:
    """Remove both trees, both branches and the recorded base."""
    for tree in ([trees.spec_tree(slug)] + ([trees.impl_tree(slug)] if has_impl else [])):
        trees.unlink_tooling(tree)
        git("worktree", "remove", tree)
    branches = [trees.spec_branch(slug)] + ([trees.impl_branch(slug)] if has_impl else [])
    for branch in branches:
        git("branch", "-d", branch, check=False)
    trees.forget_base(slug)
    note("  both worktrees removed")


def abort(slug: str) -> None:
    """Take the pair back out: trees, branches and recorded base alike."""
    for tree in (trees.spec_tree(slug), trees.impl_tree(slug)):
        if os.path.isdir(path(tree)):
            trees.unlink_tooling(tree)
            git("worktree", "remove", "--force", tree, check=False)
    git("worktree", "prune", check=False)
    for branch in (trees.spec_branch(slug), trees.impl_branch(slug)):
        if exists(branch):
            git("branch", "-D", branch, check=False)
    trees.forget_base(slug)


def behind(base: str) -> str:
    """How many commits the target branch has moved since a pair was cut."""
    done = subprocess.run(
        ("git", "-C", trees.ROOT, "rev-list", "--count", base + ".." + TARGET),
        capture_output=True,
        text=True,
        check=False,
    )
    return done.stdout.strip() if done.returncode == 0 else "?"
