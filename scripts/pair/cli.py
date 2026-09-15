#!/usr/bin/env python3
"""Move a block between the reviewer, the writer and the tree.

    pair.sh open <slug>      cut the spec worktree, on the reviewed block only
    pair.sh respec <slug>    land a re-approved block on the open spec branch
    pair.sh red <slug>       run the suite there, and remove whole-file targets
    pair.sh merge <slug>     converge the pair and land it on the target branch
    pair.sh abort <slug>     take the pair back out, trees and branches alike
    pair.sh list             the pairs with a recorded base
    pair.sh review <slug>    the path the next spec round is written to
    pair.sh review plan <slug>     the same, for the next plan round
    pair.sh restore <slug> <rev>   put the approved block back as it was at <rev>
    pair.sh impl checkout <slug>   cut the implementation tree, or name the cut one
    pair.sh impl merge <slug>      merge the implementation tree back

The stdout of each is contract, and `docs/agents.md` carries the table. A blind
writer reads these literals there, never here. This file owns every line of
that stdout: the three modules beside it print to stderr only, so a progress
line can never be read as a contract line.

`open` refuses on a mismatch because the approved spec is editable after the
reviewer passed it and the round file is not. Comparing the two is what makes
the block that reaches the writer the block that was reviewed, rather than the
latest one someone typed. `respec` makes the same comparison and one more: the
round has to be newer than the one the spec branch already committed.
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import blocks  # noqa: E402
import converge  # noqa: E402
import trees  # noqa: E402
from trees import REVIEWS, TARGET, die, git, git_ok, note, path, sh  # noqa: E402

USAGE = (
    "usage: pair.sh open|respec|red|merge|abort <slug> | list"
    " | review [plan] <slug> | restore <slug> <rev> | impl checkout|merge <slug>"
)


def out(line: str) -> None:
    """One contract line. Every `print` in this repository's pair driver is here."""
    sys.stdout.write(line + "\n")


def check_slug(slug: str) -> str:
    """A slug names two branches and two directories. Keep it boring."""
    if not slug or not re.fullmatch(sh.SLUG, slug):
        die("pair: slug '" + slug + "' -- letters, digits, dot, dash and underscore only.")
    return slug


def approved(slug: str) -> tuple[str, str]:
    """The approved block's path and text, or an exit where there is none."""
    relative = blocks.spec_path(slug)
    text = blocks.read(relative)
    if text is None:
        die("pair: no approved spec at " + relative)
    return relative, text


def round_match(slug: str, text: str) -> str | None:
    """The newest round file, where the block's reviewer section is that file.

    Returns None where the two texts differ; the caller prints `MISMATCH`, which
    is a contract line and so is not printed here.
    """
    newest = blocks.newest_round(slug)
    if newest is None:
        die("pair: no reviewer round on disk for " + slug)
    if blocks.reviewer_section(text) != (blocks.read(newest) or ""):
        return None
    return newest


# --- the pair -----------------------------------------------------------------


def cmd_open(slug: str) -> int:
    relative, text = approved(slug)
    newest = round_match(slug, text)
    if newest is None:
        out("MISMATCH " + blocks.newest_round(slug))
        return 1

    tree = trees.spec_tree(slug)
    if os.path.exists(path(tree)):
        die("pair: " + tree + " already exists -- abort that pair, or pick another slug.")
    if trees.exists(trees.spec_branch(slug)):
        die("pair: branch " + trees.spec_branch(slug) + " already exists.")

    base = git("rev-parse", "HEAD")
    git("worktree", "add", "--quiet", "-b", trees.spec_branch(slug), tree)
    trees.record_base(slug, base)
    trees.link_tooling(tree)
    note("  base " + base + ", block at " + relative)
    out("OPEN " + tree)
    return 0


def cmd_respec(slug: str) -> int:
    relative, text = approved(slug)
    tree = trees.spec_tree(slug)
    if not os.path.isdir(path(tree)):
        die("pair: no spec worktree at " + tree + " -- was this pair opened?")
    newest = round_match(slug, text)
    if newest is None:
        out("MISMATCH " + blocks.newest_round(slug))
        return 1
    if blocks.committed_section(tree, slug) == blocks.reviewer_section(text):
        die(
            "pair: " + newest + " is the round already committed on "
            + trees.spec_branch(slug) + " -- a re-approved block carries a new round,"
            " not the last one pasted under a changed block."
        )

    with open(path(tree, relative), "w", encoding="utf-8") as handle:
        handle.write(text)
    if git_ok("diff", "--quiet", "HEAD", "--", relative, tree=tree):
        die("pair: " + relative + " matches the block at HEAD -- nothing for the delta to read.")
    #: the block alone. The writer may hold uncommitted tests in this tree, and a
    #: spec commit that swept them in would hide them from the next red run.
    git("add", "--", relative, tree=tree)
    if trees.in_tree(tree, ["git", "commit", "-q", "-m", "spec: " + slug]) != 0:
        die("pair: the spec commit in " + tree + " failed")
    out("RESPEC " + relative + " " + git("rev-parse", "HEAD", tree=tree))
    return 0


def _pytest_argv() -> list[str]:
    """The configured python runner, as this checkout runs it.

    `pytest_command` from `blind-reads.json`, so a project that deselects a
    marker names it once there instead of editing this file and
    `scripts/blind.sh` both. A word carrying a slash is a path in the checkout
    and is made absolute, because the run happens with a worktree as its working
    directory; a bare word is on `PATH` and is left alone. `PYTEST` in the
    environment replaces the head word and keeps the configured arguments.
    """
    words = sh.pytest_command()
    head = os.environ.get("PYTEST") or words[0]
    if not os.path.isabs(head) and "/" in head:
        head = path(head)
    return [head] + words[1:]


def cmd_red(slug: str) -> int:
    _, text = approved(slug)
    tree = trees.spec_tree(slug)
    if not os.path.isdir(path(tree)):
        die("pair: no spec worktree at " + tree)
    blocks.strike_whole_files(tree, text)
    out(blocks.red_run(slug, tree, _pytest_argv()))
    return 0


def _brief(slug: str, tree: str, base: str, head: str) -> list[str]:
    """The five lines a `gauntlet-bailiff` is briefed with, and the file they name."""
    saved = blocks.merge_artifact(slug, base, head, tree)
    return [
        "TEST CHECK " + slug,
        "spec commit: " + blocks.spec_blob(tree, slug),
        "red commit: " + git("rev-parse", trees.spec_branch(slug)),
        "merge output: " + saved,
        "END TEST CHECK",
    ]


def cmd_merge(slug: str) -> int:
    relative, text = approved(slug)
    tree = trees.spec_tree(slug)
    impl = trees.impl_tree(slug)
    if not os.path.isdir(path(tree)):
        die("pair: no spec worktree at " + tree + " -- was this pair opened?")
    #: an implementation tree that was never cut is a tests-only pair, which is
    #: the ordinary shape of the two tests-only kinds: skipped, never fatal
    has_impl = os.path.isdir(path(impl)) and trees.exists(trees.impl_branch(slug))
    if not has_impl:
        note("  no implementation tree for " + slug + "; the spec tree lands alone")

    note("  [1/6] lane check")
    lanes = trees.lane_check(tree, "spec")
    if has_impl and not trees.lane_check(impl, "impl"):
        lanes = False
    if not lanes:
        die("pair: the lanes are what make this combine conflict-free; move those files.")

    note("  [2/6] commit both trees")
    trees.commit_tree(tree, "test: " + slug)
    if has_impl:
        trees.commit_tree(impl, "feat: " + slug)

    with converge.Lock():
        note("  [3/6] rebase onto " + TARGET)
        converge.rebase_if_moved(slug, has_impl)
        if has_impl:
            note("  [4/6] combine in the spec tree")
            converge.combine(slug)

        base = git("merge-base", TARGET, trees.spec_branch(slug))
        head = git("rev-parse", "HEAD", tree=tree)
        kind = blocks.block_kind(text)
        mechanical = kind in ("strike", "amend")

        note("  [5/6] gate")
        if not converge.gate(slug):
            #: the evidence goes to stderr here: nothing landed, so nothing on
            #: stdout should read as the brief of a merged block
            note("")
            note("pair: the gate is red in the combined tree. " + TARGET + " is untouched")
            note("and both trees are left exactly as they are: " + tree)
            note("A failing test here means the block and the code disagree. The code is")
            note("wrong and the fix lands in the implementation tree, or the block is wrong")
            note("and it goes back for re-approval. Tests are not edited to pass.")
            if mechanical:
                for line in blocks.strike_report(text, base, head, tree):
                    note("  " + line)
            else:
                note("  merge output: " + blocks.merge_artifact(slug, base, head, tree))
            return 1

        if mechanical:
            #: no implementation phase, so no window for a test to soften in:
            #: the mechanical check takes the gauntlet-bailiff's round
            verdicts = blocks.strike_report(text, base, head, tree)
            for line in verdicts:
                out(line)
            if not all(line.startswith("OK ") for line in verdicts):
                die("pair: the landed tests do not match the block that approved them.")
        else:
            for line in _brief(slug, tree, base, head):
                out(line)

        note("  [6/6] land on " + TARGET)
        converge.land(slug)
        converge.cleanup(slug, has_impl)
    return 0


def cmd_abort(slug: str) -> int:
    converge.abort(slug)
    out("ABORTED " + slug)
    return 0


def cmd_list() -> int:
    slugs = trees.open_pairs()
    if not slugs:
        out("NO PAIRS")
        return 0
    for slug in slugs:
        base = trees.read_base(slug) or "unknown"
        out("PAIR " + slug + " " + base + " " + converge.behind(base))
    return 0


# --- the paths a reviewer and the owner are handed -----------------------------


def cmd_review(first: str, second: str | None) -> int:
    """The path a reviewer writes its round to, counted here and handed to it.

    A reviewer cannot count the directory itself: `reviews-lane.py` denies it
    every read of the reviewers' lane, so a reviewer left to pick its own `<N>`
    is guessing, and a guess that lands on a number already taken overwrites a
    round that exists in no git object and is gone.
    """
    infix = ""
    slug = first
    if first == "plan":
        infix = "plan."
        slug = second or ""
    check_slug(slug)
    #: the reviewer's Write is its own; the directory it writes into is not
    os.makedirs(path(REVIEWS), exist_ok=True)
    number = blocks.highest_round(slug, infix) + 1
    out("REVIEW " + REVIEWS + "/" + slug + "." + infix + str(number) + ".txt")
    return 0


def cmd_restore(slug: str, rev: str | None) -> int:
    """The hand-carved `git restore --source` step of `docs/approved-specs.md`.

    The classifier carves out that one shell shape, and a subcommand keeps the
    carve-out in one place rather than in every transcript.
    """
    if not rev:
        die("usage: pair.sh restore <slug> <rev>")
    relative = blocks.spec_path(slug)
    git("restore", "--source", rev, "--", relative)
    out("RESTORED " + relative + " " + rev)
    return 0


def cmd_impl(verb: str, slug: str | None) -> int:
    """The implementation tree, cut beside the spec tree and merged back from it."""
    if not slug:
        die("usage: pair.sh impl checkout|merge <slug>")
    check_slug(slug)
    tree = trees.impl_tree(slug)
    if verb == "checkout":
        #: a second checkout of a slug already cut is the same tree, not a fresh
        #: one: re-cutting would discard the implementation in progress in it
        if not os.path.isdir(path(tree)):
            git("worktree", "add", "--quiet", "-b", trees.impl_branch(slug), tree)
            trees.link_tooling(tree)
        out("IMPL " + tree)
        return 0
    if verb == "merge":
        if not os.path.isdir(path(tree)):
            die("pair: no implementation worktree at " + tree)
        git("merge", "--no-edit", "-q", trees.impl_branch(slug))
        out("MERGED " + slug + " " + git("rev-parse", "HEAD"))
        return 0
    die("usage: pair.sh impl checkout|merge <slug>")
    return 2


# --- dispatch ------------------------------------------------------------------


def main(argv: list[str]) -> int:
    if not argv:
        die(USAGE)
    verb, rest = argv[0], argv[1:]

    if verb == "list":
        if rest:
            die(USAGE)
        return cmd_list()
    if not rest:
        die(USAGE)

    if verb == "review":
        return cmd_review(rest[0], rest[1] if len(rest) > 1 else None)
    if verb == "impl":
        return cmd_impl(rest[0], rest[1] if len(rest) > 1 else None)
    if verb == "restore":
        return cmd_restore(check_slug(rest[0]), rest[1] if len(rest) > 1 else None)

    one = {
        "open": cmd_open,
        "respec": cmd_respec,
        "red": cmd_red,
        "merge": cmd_merge,
        "abort": cmd_abort,
    }.get(verb)
    if one is None or len(rest) != 1:
        die(USAGE)
    return one(check_slug(rest[0]))


# --- self-test -----------------------------------------------------------------


def self_test() -> int:
    """Pin the parsing and the stdout literals, without touching a checkout."""
    block = (
        "slug: demo\nmotion: strike\n\n"
        "1. strike tests/test_a.py::test_x\n"
        "   assertion: assert 2 + 2 == 4\n"
        "2. strike tests/test_b.py\n"
        "\n--- reviewer ---\nREADY\n1  KEEP  the counter\n"
    )
    source = open(os.path.abspath(__file__), encoding="utf-8").read()
    lines = {
        "the reviewer section is everything below the divider, verbatim": (
            blocks.reviewer_section(block) == "READY\n1  KEEP  the counter\n"
            and blocks.reviewer_section("no divider here\n") == ""
        ),
        "a block's kind is its first kind: or motion: line": (
            blocks.block_kind(block) == "strike"
            and blocks.block_kind("slug: x\nkind: new\n") == "new"
            and blocks.block_kind("slug: x\n") == ""
        ),
        "every strike target parses, and only the whole-file ones are the script's": (
            blocks.strike_targets(block) == ["tests/test_a.py::test_x", "tests/test_b.py"]
            and blocks.whole_file_targets(block) == ["tests/test_b.py"]
        ),
        "the merge artifact names its three headings in one order": (
            blocks.HEADINGS == ("test files:", "diff:", "red output:")
        ),
        "the branch and the gate are what the configuration says they are": (
            trees.TARGET == sh.target_branch() and trees.GATE == sh.gate_command()
        ),
        "every contract literal this driver prints is in this file": (
            all(
                token in source
                for token in (
                    "OPEN ",
                    "MISMATCH ",
                    "RESPEC ",
                    "REVIEW ",
                    "RESTORED ",
                    "IMPL ",
                    "MERGED ",
                    "ABORTED ",
                    "PAIR ",
                    "NO PAIRS",
                    "TEST CHECK ",
                    "END TEST CHECK",
                )
            )
        ),
        "the libraries beside this file write no contract line": (
            all(
                "sys.stdout.write" not in _sibling(name)
                for name in ("trees.py", "blocks.py", "converge.py")
            )
        ),
        "a slug is one boring name, and a path is not one": (
            _accepts("demo") and not _accepts("../etc") and not _accepts("a/b") and not _accepts("")
        ),
    }
    return sh.report(lines)


def _sibling(name: str) -> str:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), encoding="utf-8") as handle:
        return handle.read()


def _accepts(slug: str) -> bool:
    """Whether `check_slug` takes a name, without ending the process on a no."""
    return bool(slug) and bool(re.fullmatch(sh.SLUG, slug))


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(main(sys.argv[1:]))
