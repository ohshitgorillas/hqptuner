"""The checker that reads a landed tests-only diff against the block that approved it.

``python3 scripts/excision-diff.py --spec <block> --base <commit> --head <commit>``
runs with the repository as its working directory and prints one verdict per
line to stdout: an excision verdict per block line in spec order, a landing
verdict per line carrying ``as:``, then one ``UNNAMED`` per changed file under
``tests/`` that no line names.

Every case here builds a throwaway git checkout under ``tmp_path`` with two
commits in it, the block on disk beside them, and runs the checker with its
working directory there, so nothing touches the checkout this file lives in.
The last case drives ``scripts/pair.sh merge`` the same way, a subprocess with
its arguments and its combined output, and reduces the run to two observations:
whether the output carries the test-check brief, and whether it carries a
verdict line naming a path under ``tests/``.
"""

import os
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

CHECKER = REPO_ROOT / "scripts" / "excision-diff.py"

DRIVER = REPO_ROOT / "scripts" / "pair.sh"

GIT = shutil.which("git") or "/usr/bin/git"

PYTHON = shutil.which("python3") or "/usr/bin/python3"

#: The test file a block line targets by path.
SUBJECT = "tests/test_probe_subject.py"

#: The file half of an ``as:`` name, where a repair line's replacement lands.
LANDING = "tests/test_probe_landing.py"

#: A test file under ``tests/`` that no block line names.
STRAY = "tests/test_probe_stray.py"

#: The assertion a block line quotes.
QUOTED = "assert 1 == 1"

#: Where the block sits in the checkout the checker is run from.
SPEC_REL = "tests/specs/probe.txt"

#: Where an approved block lives, the only place ``open`` takes one from.
APPROVED_LANE = "docs/gauntlet/specs/approved"

#: Where the reviewer's round for a slug sits.
REVIEWS_LANE = "docs/gauntlet/reviews"

#: The verdict file the driver requires to match the block's reviewer section.
_VERDICT = "READY\n1  KEEP  the line earns its place\n"

#: The marker the merge run prints when it hands a reviewer a test-check brief.
BRIEF_MARK = "TEST CHECK"

#: The tokens a verdict line opens with.
VERDICT_TOKENS = ("OK", "UNSATISFIED", "MISSING", "UNNAMED")

#: A ``make check`` that passes, so a merge run reaches the steps after it.
_MAKEFILE_BODY = "check:\n\ttrue\n"

_IDENTITY = {
    "GIT_AUTHOR_NAME": "checker probe",
    "GIT_AUTHOR_EMAIL": "checker-probe@invalid",
    "GIT_COMMITTER_NAME": "checker probe",
    "GIT_COMMITTER_EMAIL": "checker-probe@invalid",
}


def _run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """One subprocess the way an operator runs it: argv, working directory, captured output."""
    # S603: fixed argv, git or the scripts under test plus this module's own literals and paths.
    return subprocess.run(  # noqa: S603
        argv,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env={**os.environ, **_IDENTITY},
        check=False,
    )


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return _run([GIT, *args], root)


def _module(*tests: tuple[str, str]) -> str:
    """A test module carrying the named tests, each with the assertion given."""
    return "".join(f"def {name}() -> None:\n    {assertion}\n\n\n" for name, assertion in tests)


def _excision_line(number: int, target: str, assertion: str) -> str:
    return f"{number}. excise {target}\n   rule: docs/testing.md rule 10\n   assertion: {assertion}\n"


def _repair_line(number: int, target: str, assertion: str, as_name: str) -> str:
    return (
        f"{number}. excise {target}\n"
        "   rule: docs/testing.md rule 9\n"
        f"   assertion: {assertion}\n"
        "   replace: the same behavior pinned without the wording\n"
        f"   as: {as_name}\n"
        "   kills: the behavior going unpinned once the wording goes.\n"
    )


def _behavior_line(number: int) -> str:
    return f"{number}. A caller sees the outcome arrive.\n   kills: the outcome never arriving.\n   existing: none\n"


def _block(slug: str, kind: str, *lines: str) -> str:
    """A spec block: the header, the lines given, and a reviewer section under the fence."""
    return f"slug: {slug}\nkind: {kind}\n\n" + "\n".join(lines) + f"\n--- spec-reviewer READY ---\n{_VERDICT}"


def _put(root: Path, relative: str, body: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


def _commit_state(root: Path, state: Mapping[str, str | None], message: str) -> str:
    """Write the state (a ``None`` body removes the path), commit it, and hand back the commit."""
    for relative, body in state.items():
        if body is None:
            (root / relative).unlink(missing_ok=True)
        else:
            _put(root, relative, body)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "--allow-empty", "-m", message)
    return _git(root, "rev-parse", "HEAD").stdout.strip()


def _two_commit_checkout(
    tmp_path: Path,
    block: str,
    base: Mapping[str, str | None],
    head: Mapping[str, str | None],
) -> tuple[Path, str, str]:
    """A throwaway repository carrying the block, a base commit and a head commit."""
    root = tmp_path / "checkout"
    root.mkdir()
    _git(root, "init", "-q", "-b", "dev")
    _put(root, SPEC_REL, block)
    base_sha = _commit_state(root, base, "base")
    head_sha = _commit_state(root, head, "head")
    return (root, base_sha, head_sha)


def _verdicts(root: Path, base: str, head: str) -> list[str]:
    """The verdict lines the checker prints to stdout, in the order it printed them."""
    checked = _run([PYTHON, str(CHECKER), "--spec", SPEC_REL, "--base", base, "--head", head], root)
    return checked.stdout.splitlines()


# --- 1. an excision line's verdict, by where the quoted assertion sits ---------

_TARGET = f"{SUBJECT}::test_alpha"

_LINE_ONE_BLOCK = _block("probe", "excision", _excision_line(1, _TARGET, QUOTED))

#: The subject file before the writer's work: the target test, carrying the quoted assertion.
_BEFORE = _module(("test_alpha", QUOTED), ("test_beta", "assert 2 == 2"))


@pytest.mark.parametrize(
    ("head_body", "expected"),
    [
        (_module(("test_beta", "assert 2 == 2")), [f"OK {_TARGET}"]),
        (_BEFORE, [f"UNSATISFIED {_TARGET}"]),
        (_module(("test_alpha", "assert 3 == 3"), ("test_beta", QUOTED)), [f"OK {_TARGET}"]),
    ],
    ids=["the-target-test-is-gone", "the-quoted-assertion-is-in-the-target-test", "it-is-in-a-neighbour"],
)
def test_an_excision_target_is_satisfied_unless_the_quoted_assertion_sits_in_that_test_itself(
    tmp_path: Path, head_body: str, expected: list[str]
) -> None:
    root, base, head = _two_commit_checkout(tmp_path, _LINE_ONE_BLOCK, {SUBJECT: _BEFORE}, {SUBJECT: head_body})
    assert _verdicts(root, base, head) == expected


# --- 2. a landing verdict for the lines that carry `as:`, and no others --------

_REPAIR_TARGET = f"{SUBJECT}::test_alpha"

_PLAIN_TARGET = f"{LANDING}::test_delta"

_AS_NAME = f"{STRAY}::test_gamma"

_LINE_TWO_BLOCK = _block(
    "probe",
    "repair",
    _repair_line(1, _REPAIR_TARGET, QUOTED, _AS_NAME),
    _excision_line(2, _PLAIN_TARGET, "assert 5 == 5"),
)


def test_only_the_line_carrying_an_as_name_gets_a_landing_verdict(tmp_path: Path) -> None:
    root, base, head = _two_commit_checkout(
        tmp_path,
        _LINE_TWO_BLOCK,
        {SUBJECT: _BEFORE, LANDING: _module(("test_delta", "assert 5 == 5"))},
        {SUBJECT: _module(("test_beta", "assert 2 == 2")), LANDING: _module(("test_eps", "assert 6 == 6"))},
    )
    assert _verdicts(root, base, head) == [
        f"OK {_REPAIR_TARGET}",
        f"OK {_PLAIN_TARGET}",
        f"MISSING {_AS_NAME}",
    ]


# --- 3. the changed files no line names --------------------------------------

_LANDING_AS_NAME = f"{LANDING}::test_gamma"

_LINE_THREE_BLOCK = _block("probe", "repair", _repair_line(1, _REPAIR_TARGET, QUOTED, _LANDING_AS_NAME))


def test_a_file_named_only_as_the_file_half_of_an_as_name_is_not_reported_unnamed(tmp_path: Path) -> None:
    root, base, head = _two_commit_checkout(
        tmp_path,
        _LINE_THREE_BLOCK,
        {
            SUBJECT: _BEFORE,
            LANDING: _module(("test_placeholder", "assert 7 == 7")),
            STRAY: _module(("test_stray", "assert 4 == 4")),
        },
        {
            SUBJECT: _module(("test_beta", "assert 2 == 2")),
            LANDING: _module(("test_placeholder", "assert 7 == 7"), ("test_gamma", "assert 8 == 8")),
            STRAY: _module(("test_stray", "assert 9 == 9")),
        },
    )
    assert [line for line in _verdicts(root, base, head) if line.startswith("UNNAMED")] == [f"UNNAMED {STRAY}"]


# --- 4. what merge prints, by the kind the committed block carries -------------

_PAIR_EXCISION_BLOCK = _block("{slug}", "excision", _excision_line(1, _TARGET, QUOTED))

_PAIR_NEW_BLOCK = _block("{slug}", "new", _behavior_line(1))

_PAIR_REPAIR_BLOCK = _block("{slug}", "repair", _repair_line(1, _TARGET, QUOTED, _LANDING_AS_NAME))


def _pair_checkout(tmp_path: Path, slug: str, block: str) -> Path:
    """A throwaway checkout on ``dev``: the driver, a passing ``make check``, and the pair's inputs."""
    root = tmp_path / "checkout"
    root.mkdir()
    _put(root, "Makefile", _MAKEFILE_BODY)
    _put(root, SUBJECT, _BEFORE)
    _put(root, f"{APPROVED_LANE}/{slug}.txt", block.format(slug=slug))
    _put(root, f"{REVIEWS_LANE}/{slug}.1.txt", _VERDICT)
    (root / "scripts").mkdir()
    shutil.copy2(DRIVER, root / "scripts" / DRIVER.name)
    shutil.copy2(CHECKER, root / "scripts" / CHECKER.name)
    _git(root, "init", "-q", "-b", "dev")
    _commit_state(root, {}, "init")
    return root


def _opened(root: Path, slug: str) -> Path:
    """Open the pair and hand back its spec tree."""
    opening = _run([str(root / "scripts" / DRIVER.name), "open", slug], root)
    if opening.returncode != 0:
        raise AssertionError(f"the fixture could not open a pair: {opening.stdout}{opening.stderr}")
    return root / ".claude" / "worktrees" / f"{slug}-spec"


def _is_verdict(line: str) -> bool:
    """Whether the line is a verdict: a verdict token, then a path under ``tests/``."""
    parts = line.split()
    return len(parts) >= 2 and parts[0] in VERDICT_TOKENS and parts[1].startswith("tests/")


def _output_marks(finished: subprocess.CompletedProcess[str]) -> tuple[bool, bool]:
    """Whether the run's output carries the test-check brief, and whether it carries a verdict line."""
    output = finished.stdout + finished.stderr
    return (BRIEF_MARK in output, any(_is_verdict(line) for line in output.splitlines()))


#: A pair: the slug, the block it is opened from, the block the approved copy is
#: edited to after it opens (empty for none), and whether a red run is taken.
Pair = tuple[str, str, str, str]


@pytest.mark.parametrize(
    ("pair", "expected"),
    [
        (("probe-exc", _PAIR_EXCISION_BLOCK, "", "red"), (False, True)),
        (("probe-new", _PAIR_NEW_BLOCK, "", "red"), (True, False)),
        (("probe-tampered", _PAIR_EXCISION_BLOCK, _PAIR_NEW_BLOCK, "red"), (False, True)),
        (("probe-repair", _PAIR_REPAIR_BLOCK, "", ""), (False, True)),
    ],
    ids=[
        "committed-excision",
        "committed-new",
        "committed-excision-while-the-approved-copy-says-new",
        "committed-repair-with-no-red-commit",
    ],
)
def test_the_merge_output_follows_the_kind_the_committed_block_carries(
    tmp_path: Path, pair: Pair, expected: tuple[bool, bool]
) -> None:
    slug, block, tampered, red = pair
    root = _pair_checkout(tmp_path, slug, block)
    spec_tree = _opened(root, slug)
    if red:
        (spec_tree / SUBJECT).write_text(_module(("test_beta", "assert 2 == 2")), encoding="utf-8")
        _run([str(root / "scripts" / DRIVER.name), red, slug], root)
    if tampered:
        _put(root, f"{APPROVED_LANE}/{slug}.txt", tampered.format(slug=slug))
        _commit_state(root, {}, "the approved copy edited after the pair opened")
    merged = _run([str(root / "scripts" / DRIVER.name), "merge", slug], root)
    assert _output_marks(merged) == expected
