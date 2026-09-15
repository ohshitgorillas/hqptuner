#!/usr/bin/env python3
"""The approved block, the rounds beside it, and the evidence a run leaves.

An approved block is one file in the reviewer's lane. Everything above the
`--- reviewer ---` divider is the contract; everything below it is the
reviewer's own output, and `open` refuses a pair whose section differs from the
round file on disk, because the block is editable after the reviewer passed it
and the round is not.

Like `trees.py`, nothing here prints to stdout.
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys

import trees
from trees import GAUNTLET, REVIEWS, SPECS, TESTS, git, git_out, note, path

DIVIDER = "--- reviewer ---"

#: `N. strike <target>` of a committed block, targets only
_STRIKE = re.compile(r"^\s*\d+\.\s*strike\s+(?P<target>.*?)\s*$")
#: the structure line: `kind:` for a block that writes tests, `motion:` for one
#: that removes them
_KIND = re.compile(r"^(?:kind|motion):\s*(?P<kind>.*?)\s*$")

#: the three headings `<gauntlet dir>/merge/<slug>.txt` carries, in this order
HEADINGS = ("test files:", "diff:", "red output:")


def _load_strike_diff():
    """`scripts/strike-diff.py`, imported rather than run.

    Its name is not an identifier, so it is loaded by path. A subprocess would
    be a second interpreter start and a second copy of the config, for a
    function this process can simply call.
    """
    source = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "strike-diff.py")
    spec = importlib.util.spec_from_file_location("strike_diff", source)
    if spec is None or spec.loader is None:  # pragma: no cover - a broken checkout
        sys.exit("pair: no scripts/strike-diff.py beside scripts/pair/")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def spec_path(slug: str) -> str:
    return SPECS + "/" + slug + ".txt"


def red_path(slug: str) -> str:
    return GAUNTLET + "/red/" + slug + ".txt"


def merge_path(slug: str) -> str:
    return GAUNTLET + "/merge/" + slug + ".txt"


def read(relative: str) -> str | None:
    try:
        with open(path(relative), encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def reviewer_section(text: str) -> str:
    """Everything below the divider, verbatim, or the empty string for none."""
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.rstrip("\n") == DIVIDER:
            return "".join(lines[index + 1 :])
    return ""


def highest_round(slug: str, infix: str) -> int:
    """The highest `<N>` on disk for a slug in one round series, or 0 for none.

    The series is named by its infix: empty for the spec rounds
    `<slug>.<N>.txt`, `plan.` for the plan rounds `<slug>.plan.<N>.txt`. A name
    that is not a numbered round of the series asked for is not counted, so the
    two series never read as each other.
    """
    shape = re.compile(re.escape(slug + "." + infix) + r"(\d+)\.txt\Z")
    best = 0
    try:
        names = os.listdir(path(REVIEWS))
    except OSError:
        return 0
    for name in names:
        found = shape.match(name)
        if found:
            best = max(best, int(found.group(1)))
    return best


def newest_round(slug: str) -> str | None:
    """The newest spec round the reviewer has written for this slug, or None."""
    highest = highest_round(slug, "")
    if highest == 0:
        return None
    return REVIEWS + "/" + slug + "." + str(highest) + ".txt"


def block_kind(text: str) -> str:
    for line in text.splitlines():
        found = _KIND.match(line)
        if found:
            return found.group("kind")
    return ""


def strike_targets(text: str) -> list[str]:
    targets = []
    for line in text.splitlines():
        found = _STRIKE.match(line)
        if found and found.group("target"):
            targets.append(found.group("target"))
    return targets


def whole_file_targets(text: str) -> list[str]:
    """The targets no writer can remove.

    A single test is an `Edit` and the writer's; a whole file cannot be, because
    the lane hook denies every agent the shell it would take.
    """
    return [target for target in strike_targets(text) if "::" not in target]


def red_run(slug: str, tree: str, runner: list[str]) -> str:
    """Run the suite in the spec tree and save the output. Returns its path.

    `runner` is the configured invocation: the caller resolves it, and this
    function drops its quiet flag and adds its own verbose one.
    """
    saved = red_path(slug)
    os.makedirs(path(os.path.dirname(saved)), exist_ok=True)
    #: verbose, so a passing test is named rather than summarized as a dot: the
    #: juror rules on the names this file carries and on nothing else. A `-q`
    #: in the configured command cancels `-v` back to dots, so it goes.
    words = [word for word in runner if word != "-q"]
    output = trees.capture_in_tree(tree, words + ["-v"])
    with open(path(saved), "w", encoding="utf-8") as handle:
        handle.write(output)
    return saved


def merge_artifact(slug: str, base: str, head: str, tree: str) -> str:
    """Write `<gauntlet dir>/merge/<slug>.txt` and return its path.

    Evidence by path, not by paste: the main agent only carries the brief, and
    the `gauntlet-bailiff` reads this file itself.
    """
    saved = merge_path(slug)
    os.makedirs(path(os.path.dirname(saved)), exist_ok=True)
    names = git_out("diff", "--name-only", base, head, "--", TESTS + "/", tree=tree)
    diff = git_out("diff", base, head, "--", TESTS + "/", tree=tree)
    #: no red log on disk is a complete brief with an empty section, not an
    #: abort that leaves the block unterminated
    red = read(red_path(slug)) or ""
    with open(path(saved), "w", encoding="utf-8") as handle:
        handle.write(HEADINGS[0] + "\n" + names)
        handle.write(HEADINGS[1] + "\n" + diff)
        handle.write(HEADINGS[2] + "\n" + red)
    return saved


def strike_report(block: str, base: str, head: str, tree: str) -> list[str]:
    """The `scripts/strike-diff.py` verdicts for a landed tests-only change.

    That module runs git in the process's own directory, so the call is made
    from the tree being checked and the directory is put back afterwards.
    """
    module = _load_strike_diff()
    here = os.getcwd()
    os.chdir(path(tree))
    try:
        return module.report(block, base, head)
    finally:
        os.chdir(here)


def committed_section(tree: str, slug: str) -> str:
    """The block's reviewer section as the spec branch last committed it.

    Matching the block against the newest round proves the round was pasted
    verbatim; it cannot tell that round from the one already committed. A
    re-approved block carries a new round, so comparing the two is what keeps
    the last `READY` from being pasted under a changed block.
    """
    return reviewer_section(git_out("show", "HEAD:" + spec_path(slug), tree=tree))


def strike_whole_files(tree: str, block: str) -> None:
    """Remove the whole-file targets of a block from a tree.

    Two passes on purpose: every target is validated before any file goes, so a
    block whose third line names source leaves the first two files standing.
    """
    targets = whole_file_targets(block)
    prefix = TESTS + "/"
    for target in targets:
        if not target.startswith(prefix):
            trees.die(
                "pair: strike target '"
                + target
                + "' is not under "
                + prefix
                + " -- a strike motion removes tests, never source."
            )
        if ".." in target:
            trees.die(
                "pair: strike target '" + target + "' contains '..' -- name the path"
                " as it sits under " + prefix + "."
            )
    for target in targets:
        try:
            os.unlink(path(tree, target))
        except OSError:
            continue
        note("  struck " + target)


def spec_blob(tree: str, slug: str) -> str:
    """The object name of the block as that tree's HEAD holds it."""
    found = git("rev-parse", "HEAD:" + spec_path(slug), tree=tree, check=False)
    return found or "unknown"
