"""The pair driver on a pair whose block removes test files.

``scripts/pair.sh red <slug>`` lands the writer's work on the spec branch as a
single ``test: <slug> red`` commit. No step takes a path argument: the block a
pair is opened from is the one ``specs/approved/<slug>.txt`` carries.

Every case builds a throwaway git checkout under ``tmp_path``, copies the
driver into it, opens a pair there and runs the red step there, so nothing in
this file touches the checkout it lives in. The driver is driven the way an
operator drives it: a subprocess, its arguments, its exit status, and what it
leaves behind in the spec tree and on the spec branch. Nothing reaches inside
the script.

The observed values are the run's outcome (``clean`` for exit 0, ``refused``
for anything else), the name-status listing of the ``test: <slug> red`` commit
on the spec branch, and whether a spec tree was left behind.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

DRIVER = REPO_ROOT / "scripts" / "pair.sh"

CHECKER = REPO_ROOT / "scripts" / "excision-diff.py"

GIT = shutil.which("git") or "/usr/bin/git"

#: The tracked test file an excision block targets.
TARGET = "tests/test_probe_target.py"

#: A second tracked test file, edited in the spec tree, so that a run with no
#: excision handling at all still has something of the writer's to commit.
EDITED = "tests/test_probe_other.py"

#: A tracked source path, the one an excision line must never resolve.
SOURCE = "hqptuner/config.py"

#: Where an approved block lives, the only place ``open`` takes one from.
APPROVED_LANE = "docs/gauntlet/specs/approved"

#: The directory an unapproved draft sits in, outside that lane.
DRAFT_LANE = "docs/gauntlet/specs/drafts"

#: Where the reviewer's round for a slug sits, beside the approved lane.
REVIEWS_LANE = "docs/gauntlet/reviews"

_TEST_BODY = '''"""A tracked test file, here so that a pair's spec tree can remove it."""


def test_it_holds() -> None:
    assert 1 == 1
'''

_SOURCE_BODY = "SETTING = 1\n"

#: A ``make check`` that passes, so a merge run reaches the steps after it.
_MAKEFILE_BODY = "check:\n\ttrue\n"

#: The reviewer's verdict file, which the driver requires to match the spec
#: file's reviewer section byte for byte.
_VERDICT = "READY\n1  KEEP  the line earns its place\n"

_NEW_BLOCK = """slug: {slug}
kind: new

1. A caller sees the thing happen.
   kills: the thing not happening.
   existing: none

--- spec-reviewer READY ---
{verdict}"""

_IDENTITY = {
    "GIT_AUTHOR_NAME": "pair probe",
    "GIT_AUTHOR_EMAIL": "probe@example.invalid",
    "GIT_COMMITTER_NAME": "pair probe",
    "GIT_COMMITTER_EMAIL": "probe@example.invalid",
}


def _env() -> dict[str, str]:
    return {**os.environ, **_IDENTITY}


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run git against the throwaway checkout."""
    # S603: fixed argv, git plus this module's own literals and paths it wrote.
    return subprocess.run(  # noqa: S603
        [GIT, "-C", str(root), *args],
        capture_output=True,
        text=True,
        env=_env(),
        check=False,
    )


def _drive(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run the driver from inside the throwaway checkout, the way an operator runs it."""
    # S603: fixed argv, the script under test plus this module's own literals.
    return subprocess.run(  # noqa: S603
        [str(root / "scripts" / DRIVER.name), *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        env=_env(),
        check=False,
    )


def _write(root: Path, relative: str, body: str) -> None:
    (root / relative).parent.mkdir(parents=True, exist_ok=True)
    (root / relative).write_text(body, encoding="utf-8")


def _checkout(tmp_path: Path, slug: str, block: str, lane: str = APPROVED_LANE) -> Path:
    """A throwaway checkout on ``dev``, carrying the driver, the tracked files and the pair's inputs."""
    root = tmp_path / "checkout"
    (root / "scripts").mkdir(parents=True)
    shutil.copy2(DRIVER, root / "scripts" / DRIVER.name)
    shutil.copy2(CHECKER, root / "scripts" / CHECKER.name)
    _write(root, "Makefile", _MAKEFILE_BODY)
    _write(root, TARGET, _TEST_BODY)
    _write(root, EDITED, _TEST_BODY)
    _write(root, SOURCE, _SOURCE_BODY)
    _write(root, f"{lane}/{slug}.txt", block)
    _write(root, f"{REVIEWS_LANE}/{slug}.1.txt", _VERDICT)
    _git(root, "init", "-q", "-b", "dev")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "init")
    return root


def _open_pair(root: Path, slug: str) -> Path:
    """Open the pair and hand back its spec tree."""
    opened = _drive(root, "open", slug)
    if opened.returncode != 0:
        raise AssertionError(f"the fixture could not open a pair: {opened.stdout}{opened.stderr}")
    return root / ".claude" / "worktrees" / f"{slug}-spec"


def _outcome(finished: subprocess.CompletedProcess[str]) -> str:
    """``clean`` when the driver exited 0, ``refused`` for any nonzero status."""
    return "clean" if finished.returncode == 0 else "refused"


def _red_commits(root: Path, slug: str) -> list[str]:
    """Every commit on the spec branch whose subject is ``test: <slug> red``, newest first."""
    log = _git(root, "log", f"spec/{slug}", "--format=%H %s")
    return [line.split(" ", 1)[0] for line in log.stdout.splitlines() if line.endswith(f"test: {slug} red")]


def _red_commit_files(root: Path, slug: str) -> list[str]:
    """The name-status listing of the red commit, sorted; empty when the branch carries no single such commit."""
    shas = _red_commits(root, slug)
    if len(shas) != 1:
        return []
    shown = _git(root, "show", "--format=", "--name-status", shas[0])
    return sorted(line for line in shown.stdout.splitlines() if line)


# --- 4. a spec tree whose only change is a deletion ---------------------------


def test_a_spec_tree_whose_only_change_is_a_removed_test_file_lands_that_removal_as_the_red_commit(
    tmp_path: Path,
) -> None:
    slug = "probe-four"
    root = _checkout(tmp_path, slug, _NEW_BLOCK.format(slug=slug, verdict=_VERDICT))
    spec_tree = _open_pair(root, slug)
    (spec_tree / TARGET).unlink()
    finished = _drive(root, "red", slug)
    assert (_outcome(finished), _red_commit_files(root, slug)) == ("clean", [f"D\t{TARGET}"])


# --- 5. open takes its block from the approved lane, by slug alone -------------

#: The pair line 5 opens, and the block it is opened from.
OPEN_SLUG = "probe-open"

_OPEN_BLOCK = _NEW_BLOCK.format(slug=OPEN_SLUG, verdict=_VERDICT)


def _opened(finished: subprocess.CompletedProcess[str], root: Path, slug: str) -> tuple[int, bool]:
    """The run's exit status, and whether it left a spec tree behind."""
    return (finished.returncode, (root / ".claude" / "worktrees" / f"{slug}-spec").is_dir())


@pytest.mark.parametrize(
    ("lane", "expected"),
    [
        (APPROVED_LANE, (0, True)),
        (DRAFT_LANE, (1, False)),
    ],
    ids=["block-in-the-approved-lane", "block-outside-the-approved-lane"],
)
def test_open_builds_a_spec_tree_only_from_the_block_the_approved_lane_carries(
    tmp_path: Path, lane: str, expected: tuple[int, bool]
) -> None:
    root = _checkout(tmp_path, OPEN_SLUG, _OPEN_BLOCK, lane=lane)
    finished = _drive(root, "open", OPEN_SLUG)
    assert _opened(finished, root, OPEN_SLUG) == expected
