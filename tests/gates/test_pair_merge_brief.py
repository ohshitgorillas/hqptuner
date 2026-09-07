"""The pair driver's merge, on what its brief says about the spec tree's tests.

``scripts/pair.sh merge <slug>`` lands a pair on ``dev`` and, on either exit
of its ``make check`` step, prints the test-check brief the orchestrator
forwards to the spec-reviewer. The brief is reduced here to which of two
marker lines it carries: ``PIN by construction`` when the spec tree's tests
are byte-identical to the ``test: <slug> red`` commit, so the reviewer has
nothing to diff, and ``diff from red`` when they are not. Both markers are
tokens the review chain keys on, not prose.

Every case builds a throwaway git checkout under ``tmp_path`` with the driver
copied in and a ``Makefile`` whose ``check`` target is ``true``, opens a pair
there, lands a red commit there and merges there, so nothing in this file
touches the checkout it lives in. The driver is driven the way an operator
drives it: a subprocess, its arguments and its combined output. Nothing
reaches inside the script.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

DRIVER = REPO_ROOT / "scripts" / "pair.sh"

GIT = shutil.which("git") or "/usr/bin/git"

#: The marker line the brief carries when the spec tree's tests match the red commit.
PIN_MARK = "PIN by construction"

#: The marker line the brief carries when they do not.
DIFF_MARK = "diff from red"

MARKS = (PIN_MARK, DIFF_MARK)

#: The test file the writer adds in the spec tree before the red run.
WRITTEN = "tests/test_probe_written.py"

_FIRST_TEST = '''"""A test file the spec tree adds, so the red commit carries it."""


def test_the_first_thing_holds() -> None:
    assert 1 == 1
'''

#: What the spec tree appends to the written file after the red commit.
_SECOND_TEST = "\n\ndef test_the_second_thing_holds() -> None:\n    assert 2 == 2\n"

_VERDICT = "READY\n1  KEEP  the caller's view earns it\n"

_BLOCK = """slug: {slug}
kind: new

1. A caller sees the outcome arrive.
   kills: the outcome never arriving.
   existing: none

--- spec-reviewer READY ---
""" + _VERDICT

_IDENTITY = {
    "GIT_AUTHOR_NAME": "merge probe",
    "GIT_AUTHOR_EMAIL": "merge-probe@invalid",
    "GIT_COMMITTER_NAME": "merge probe",
    "GIT_COMMITTER_EMAIL": "merge-probe@invalid",
}


def _run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """One subprocess the way an operator runs it: argv, working directory, captured output."""
    # S603: fixed argv, git or the driver under test plus this module's own literals and the paths it wrote.
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


def _pair(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return _run([str(root / "scripts" / DRIVER.name), *args], root)


def _put(root: Path, relative: str, body: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


def _checkout(tmp_path: Path, slug: str) -> Path:
    """A throwaway checkout on ``dev``: the driver, a ``make check`` that passes, and the pair's inputs."""
    root = tmp_path / "checkout"
    root.mkdir()
    _put(root, "Makefile", "check:\n\ttrue\n")
    _put(root, f"specs/{slug}.txt", _BLOCK.format(slug=slug))
    _put(root, f"state/reviews/{slug}.1.txt", _VERDICT)
    (root / "scripts").mkdir()
    shutil.copy2(DRIVER, root / "scripts" / DRIVER.name)
    for step in (["init", "-q", "-b", "dev"], ["add", "-A"], ["commit", "-qm", "init"]):
        _git(root, *step)
    return root


def _red_pair(root: Path, slug: str) -> Path:
    """Open the pair, write one test file in its spec tree, land the red commit, hand back the spec tree."""
    opened = _pair(root, "open", slug, f"specs/{slug}.txt")
    if opened.returncode != 0:
        raise AssertionError(f"the fixture could not open a pair: {opened.stdout}{opened.stderr}")
    spec_tree = root / ".claude" / "worktrees" / f"{slug}-spec"
    _put(spec_tree, WRITTEN, _FIRST_TEST)
    _pair(root, "red", slug)
    return spec_tree


def _markers(finished: subprocess.CompletedProcess[str]) -> set[str]:
    """Which of the two marker lines the driver's combined output carries."""
    output = finished.stdout + finished.stderr
    return {mark for mark in MARKS if mark in output}


# --- 3. the brief's marker, by whether the tests still match the red commit ---


@pytest.mark.parametrize(
    ("appended", "expected"),
    [("", {PIN_MARK}), (_SECOND_TEST, {DIFF_MARK})],
    ids=["identical-to-red", "appended-after-red"],
)
def test_the_merge_brief_pins_by_construction_only_when_the_tests_match_the_red_commit(
    tmp_path: Path, appended: str, expected: set[str]
) -> None:
    slug = "probe-merge"
    root = _checkout(tmp_path, slug)
    spec_tree = _red_pair(root, slug)
    (spec_tree / WRITTEN).write_text(_FIRST_TEST + appended, encoding="utf-8")
    merged = _pair(root, "merge", slug)
    assert _markers(merged) == expected
