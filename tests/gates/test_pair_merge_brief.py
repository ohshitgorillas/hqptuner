"""The pair driver's merge, on what it tells the operator to do next.

``scripts/pair.sh merge <slug>`` lands a pair on ``dev`` and, on either exit
of its ``make check`` step, prints a test-check brief and then closes by
telling the operator what to do with it. The run is reduced here to which of
three instruction markers its output carries: ``forward the TEST CHECK
block`` when the spec tree's tests differ from the ``test: <slug> red``
commit, so a reviewer has something to diff; ``no reviewer round`` when they
are byte-identical, so there is nothing to review; and ``no brief to
forward`` when the pair has no red commit at all. All three are tokens the
review chain keys on, not prose.

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

#: The instruction marker for a run whose brief a reviewer must see.
FORWARD_MARK = "forward the TEST CHECK block"

#: The instruction marker for a run that needs no reviewer.
NO_ROUND_MARK = "no reviewer round"

#: The instruction marker for a run that printed no brief to forward.
NO_BRIEF_MARK = "no brief to forward"

MARKS = (FORWARD_MARK, NO_ROUND_MARK, NO_BRIEF_MARK)

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


def _opened_pair(root: Path, slug: str, steps: tuple[str, ...]) -> Path:
    """Open the pair, write one test file in its spec tree, run the driver steps named after it."""
    opened = _pair(root, "open", slug, f"specs/{slug}.txt")
    if opened.returncode != 0:
        raise AssertionError(f"the fixture could not open a pair: {opened.stdout}{opened.stderr}")
    spec_tree = root / ".claude" / "worktrees" / f"{slug}-spec"
    _put(spec_tree, WRITTEN, _FIRST_TEST)
    for step in steps:
        _pair(root, step, slug)
    return spec_tree


def _markers(finished: subprocess.CompletedProcess[str]) -> set[str]:
    """Which of the three instruction markers the driver's combined output carries."""
    output = finished.stdout + finished.stderr
    return {mark for mark in MARKS if mark in output}


# --- 3. the closing instruction, by the brief the same run printed ---


@pytest.mark.parametrize(
    ("steps", "appended", "expected"),
    [
        (("red",), "", {NO_ROUND_MARK}),
        (("red",), _SECOND_TEST, {FORWARD_MARK}),
        ((), "", {NO_ROUND_MARK, NO_BRIEF_MARK}),
    ],
    ids=["identical-to-red", "appended-after-red", "no-red-commit"],
)
def test_the_merge_closing_instruction_follows_the_brief_the_same_run_printed(
    tmp_path: Path, steps: tuple[str, ...], appended: str, expected: set[str]
) -> None:
    slug = "probe-merge"
    root = _checkout(tmp_path, slug)
    spec_tree = _opened_pair(root, slug, steps)
    (spec_tree / WRITTEN).write_text(_FIRST_TEST + appended, encoding="utf-8")
    merged = _pair(root, "merge", slug)
    assert _markers(merged) == expected
