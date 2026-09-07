"""The pair driver's red run, on a pair whose spec tree removes test files.

``scripts/pair.sh red <slug>`` lands the writer's work on the spec branch as a
single ``test: <slug> red`` commit. It takes no path argument: a spec file is
accepted only by ``open`` and ``respec``.

A ``kind: excision`` block carries excision lines, ``N. excise <target>`` with
a ``rule:`` and an ``assertion:`` under it. A target with no ``::`` in it names
a whole file.

Every case builds a throwaway git checkout under ``tmp_path``, copies the
driver into it, opens a pair there and runs the red step there, so nothing in
this file touches the checkout it lives in. The driver is driven the way an
operator drives it: a subprocess, its arguments, its exit status, and what it
leaves behind in the spec tree and on the spec branch. Nothing reaches inside
the script.

The observed values are the run's outcome (``clean`` for exit 0, ``refused``
for anything else), the name-status listing of the ``test: <slug> red`` commit
on the spec branch, and what the spec tree still carries afterwards.
"""

import os
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

DRIVER = REPO_ROOT / "scripts" / "pair.sh"

GIT = shutil.which("git") or "/usr/bin/git"

#: The tracked test file an excision block targets.
TARGET = "tests/test_probe_target.py"

#: A second tracked test file, edited in the spec tree, so that a run with no
#: excision handling at all still has something of the writer's to commit.
EDITED = "tests/test_probe_other.py"

#: A tracked source path, the one an excision line must never resolve.
SOURCE = "hqptuner/config.py"

_TEST_BODY = '''"""A tracked test file, here so that a pair's spec tree can remove it."""


def test_it_holds() -> None:
    assert 1 == 1
'''

_SOURCE_BODY = "SETTING = 1\n"

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

_EXCISION_BLOCK = """slug: {slug}
kind: excision

1. excise {target}
   rule: docs/testing.md rule 10
   assertion: assert 1 == 1

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


def _checkout(tmp_path: Path, slug: str, block: str) -> Path:
    """A throwaway checkout on ``dev``, carrying the driver, the tracked files and the pair's inputs."""
    root = tmp_path / "checkout"
    (root / "scripts").mkdir(parents=True)
    shutil.copy2(DRIVER, root / "scripts" / DRIVER.name)
    _write(root, TARGET, _TEST_BODY)
    _write(root, EDITED, _TEST_BODY)
    _write(root, SOURCE, _SOURCE_BODY)
    _write(root, f"specs/{slug}.txt", block)
    _write(root, f"state/reviews/{slug}.1.txt", _VERDICT)
    _git(root, "init", "-q", "-b", "dev")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "init")
    return root


def _open_pair(root: Path, slug: str) -> Path:
    """Open the pair and hand back its spec tree."""
    opened = _drive(root, "open", slug, f"specs/{slug}.txt")
    if opened.returncode != 0:
        raise AssertionError(f"the fixture could not open a pair: {opened.stdout}{opened.stderr}")
    return root / ".claude" / "worktrees" / f"{slug}-spec"


def _edit_a_test(spec_tree: Path) -> None:
    """The writer's own work in the spec tree: one edited test file, alongside whatever the block excises."""
    (spec_tree / EDITED).write_text(
        _TEST_BODY + "\n\ndef test_it_still_holds() -> None:\n    assert 2 == 2\n", encoding="utf-8"
    )


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


# --- 1. a whole-file target naming a test file that exists --------------------


def test_a_whole_file_target_is_removed_from_the_spec_tree_and_the_removal_is_in_the_red_commit(
    tmp_path: Path,
) -> None:
    slug = "probe-one"
    root = _checkout(tmp_path, slug, _EXCISION_BLOCK.format(slug=slug, target=TARGET, verdict=_VERDICT))
    spec_tree = _open_pair(root, slug)
    _edit_a_test(spec_tree)
    _drive(root, "red", slug)
    assert ((spec_tree / TARGET).exists(), _red_commit_files(root, slug)) == (
        False,
        [f"D\t{TARGET}", f"M\t{EDITED}"],
    )


# --- 2. a whole-file target under tests/ that no file carries ------------------


def test_a_whole_file_target_no_file_carries_refuses_the_run_and_lands_no_red_commit(
    tmp_path: Path,
) -> None:
    slug = "probe-two"
    missing = "tests/test_probe_absent.py"
    root = _checkout(tmp_path, slug, _EXCISION_BLOCK.format(slug=slug, target=missing, verdict=_VERDICT))
    spec_tree = _open_pair(root, slug)
    _edit_a_test(spec_tree)
    finished = _drive(root, "red", slug)
    assert (_outcome(finished), len(_red_commits(root, slug))) == ("refused", 0)


# --- 3. a whole-file target that does not begin tests/ ------------------------


def test_a_whole_file_target_outside_tests_refuses_the_run_and_leaves_the_path_it_names_in_place(
    tmp_path: Path,
) -> None:
    slug = "probe-three"
    root = _checkout(tmp_path, slug, _EXCISION_BLOCK.format(slug=slug, target=SOURCE, verdict=_VERDICT))
    spec_tree = _open_pair(root, slug)
    _edit_a_test(spec_tree)
    finished = _drive(root, "red", slug)
    assert (_outcome(finished), (spec_tree / SOURCE).exists()) == ("refused", True)


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
