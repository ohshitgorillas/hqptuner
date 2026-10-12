"""The suite-time gate keeps one baseline per branch.

Several branches of this repository are checked out at once, each in its own
git worktree, all sharing one main checkout. A green run on a branch is judged
against that branch's last green run and recorded into it alone; a run on any
other branch, in any other worktree or in the same one after a switch, neither
reads that baseline nor moves it. A branch with no baseline of its own is judged
against the baseline of the recorded branch nearest ``HEAD`` in history, fewest
commits on ``HEAD`` not on it first, then fewest commits on it not on ``HEAD``,
as git itself counts them; once it has passed, its baseline is its own. Each
run deletes the baseline of every branch that no longer exists.

Each case builds a miniature repository under ``tmp_path`` in git's own on-disk
format, written from tables rather than by running git: a main checkout whose
``.git`` directory holds one empty commit, branch ``dev`` checked out, and
where the case needs one a linked worktree on ``v2`` beside it, laid out the way
``git worktree add`` lays one out (a ``.git`` file naming a private git dir
under the main checkout's ``.git/worktrees/``, whose ``commondir`` leads back).
A case about history adds commits on the empty tree from a table of parents and
points branches at them. A branch switch rewrites ``HEAD`` the way
``git switch`` does, and a branch deletion removes its ref file the way
``git branch -D`` does for a loose ref. The layouts are ones real git reads as
such, and the gate asks the git binary every history question.

A copy of this checkout's gate script sits in every tree at the path
``make test`` runs it from, and each run loads that copy afresh and calls its CLI
entry ``main([])``, so the gate judges the tree it lives in as ``make test``
would. The junit report it reads is written where ``make test`` writes it.
Observable contract is the sequence of exit codes; nothing here reads the
gate's internals or the baseline files it writes.

Every ambient ``GIT_*`` name is dropped and ``HOME`` and git's global and system
configuration point into ``tmp_path``, so a gate
that asks git itself sees only the miniature repository.
"""

import hashlib
import importlib.util
import os
import shutil
import zlib
from pathlib import Path

import pytest
from narrow import FixtureError

#: The gate under test, found relative to this file: it lives in ``scripts/``,
#: outside any package.
GATE_REL = Path("scripts") / "gates" / "testing" / "check_suite_time.py"
GATE_PATH = Path(__file__).resolve().parents[2] / GATE_REL

#: Where ``make test`` has pytest write the junit report, relative to the tree
#: it runs in (``--junitxml=.pytest-junit.xml`` in the Makefile).
REPORT_REL = Path(".pytest-junit.xml")

#: The first green run's wall time, which seeds a branch's baseline.
SEED_SECONDS = 50.0

#: 7.5 s over ``SEED_SECONDS``: past the escalate band, short of the reject
#: band, so a run of this length against a 50.0 s baseline fails without accept.
ESCALATED_SECONDS = 57.5

#: Well under ``SEED_SECONDS``: a run of this length passes against it and, on
#: the branch it ran on, becomes that branch's baseline.
FAST_SECONDS = 40.0

#: 2.5 s under ``SEED_SECONDS`` and 7.5 s over ``FAST_SECONDS``: passes against
#: the first, fails without accept against the second.
BETWEEN_SECONDS = 47.5

#: A non-bare repository's config, as ``git init`` writes it.
GIT_CONFIG = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n"

#: Every fixture commit's tree line: git's empty tree.
COMMIT_TREE = b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"

#: Every fixture commit's author and committer: a fixed identity and date.
COMMIT_IDENTITY = (
    b"author Gate Fixture <gate@example.invalid> 1757160000 +0000\n"
    b"committer Gate Fixture <gate@example.invalid> 1757160000 +0000\n"
)

#: The one commit every branch points at in the cases without history.
COMMIT_BODY = COMMIT_TREE + COMMIT_IDENTITY + b"\nstart\n"

#: 20 s over ``SEED_SECONDS``: the bar of the farther branch in the history case,
#: one a run of ``ESCALATED_SECONDS`` passes against.
FAR_SECONDS = 70.0

#: The history case's commits, each on the empty tree, as (message, parent
#: message): a line ``start``, ``one``, ``two``, ``topic`` and five commits off
#: ``two`` on a side line.
HISTORY: tuple[tuple[str, str | None], ...] = (
    ("start", None),
    ("one", "start"),
    ("two", "one"),
    ("topic", "two"),
    ("side 1", "two"),
    ("side 2", "side 1"),
    ("side 3", "side 2"),
    ("side 4", "side 3"),
    ("side 5", "side 4"),
)

#: The history case's branches, by the message of the commit each points at.
#: Counted from ``topic`` as ``git rev-list --left-right --count HEAD...<branch>``
#: counts: ``near`` is 1 and 5, ``far`` is 2 and 0, so ``near`` has fewer
#: commits on ``HEAD`` not on it and ``far`` the smaller sum.
HISTORY_BRANCHES = {"far": "one", "near": "side 5", "topic": "topic"}


def isolate_from_ambient_git(monkeypatch: pytest.MonkeyPatch, home: Path) -> None:
    """Drop every ambient ``GIT_*`` name and point HOME and git's configuration into ``home``."""
    for name in [name for name in os.environ if name.startswith("GIT_")]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / "no-such-gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", str(home / "no-such-gitconfig"))


def write_object(git_dir: Path, kind: bytes, body: bytes) -> str:
    """Store one loose object the way git does and return its name."""
    raw = kind + b" " + str(len(body)).encode() + b"\0" + body
    name = hashlib.sha1(raw, usedforsecurity=False).hexdigest()
    path = git_dir / "objects" / name[:2] / name[2:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(zlib.compress(raw))
    return name


def install_gate(tree: Path) -> None:
    """Put a copy of this checkout's gate script in ``tree`` where ``make test`` runs it from."""
    if not GATE_PATH.is_file():
        raise FixtureError(reason=f"no gate script at {GATE_PATH}")
    target = tree / GATE_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(GATE_PATH, target)


def main_checkout_on_dev(tmp_path: Path) -> Path:
    """A main checkout with one commit, branches ``dev`` and ``v2`` on it, ``dev`` checked out."""
    repo = tmp_path / "repo"
    git_dir = repo / ".git"
    (git_dir / "refs" / "tags").mkdir(parents=True)
    (git_dir / "config").write_text(GIT_CONFIG, encoding="utf-8")
    write_object(git_dir, b"tree", b"")
    commit = write_object(git_dir, b"commit", COMMIT_BODY)
    for branch in ("dev", "v2"):
        (git_dir / "refs" / "heads" / branch).parent.mkdir(parents=True, exist_ok=True)
        (git_dir / "refs" / "heads" / branch).write_text(f"{commit}\n", encoding="utf-8")
    check_out(repo, "dev")
    install_gate(repo)
    return repo


def main_checkout_with_history(tmp_path: Path) -> Path:
    """A main checkout holding ``HISTORY``, with ``HISTORY_BRANCHES`` on it and ``topic`` checked out."""
    repo = tmp_path / "repo"
    git_dir = repo / ".git"
    (git_dir / "refs" / "tags").mkdir(parents=True)
    (git_dir / "refs" / "heads").mkdir(parents=True)
    (git_dir / "config").write_text(GIT_CONFIG, encoding="utf-8")
    write_object(git_dir, b"tree", b"")
    names: dict[str, str] = {}
    for message, parent in HISTORY:
        parent_line = b"" if parent is None else f"parent {names[parent]}\n".encode()
        body = COMMIT_TREE + parent_line + COMMIT_IDENTITY + f"\n{message}\n".encode()
        names[message] = write_object(git_dir, b"commit", body)
    for branch, message in HISTORY_BRANCHES.items():
        (git_dir / "refs" / "heads" / branch).write_text(f"{names[message]}\n", encoding="utf-8")
    check_out(repo, "topic")
    install_gate(repo)
    return repo


def check_out(repo: Path, branch: str) -> None:
    """Switch the main checkout to ``branch`` by pointing its ``HEAD`` at it."""
    (repo / ".git" / "HEAD").write_text(f"ref: refs/heads/{branch}\n", encoding="utf-8")


def worktree_on_v2(repo: Path) -> Path:
    """A linked worktree of ``repo`` on branch ``v2``, beside it, carrying the gate."""
    tree = repo.parent / "v2"
    private = repo / ".git" / "worktrees" / "v2"
    private.mkdir(parents=True)
    tree.mkdir()
    (private / "HEAD").write_text("ref: refs/heads/v2\n", encoding="utf-8")
    (private / "commondir").write_text("../..\n", encoding="utf-8")
    (private / "gitdir").write_text(f"{tree / '.git'}\n", encoding="utf-8")
    (tree / ".git").write_text(f"gitdir: {private}\n", encoding="utf-8")
    install_gate(tree)
    return tree


def run_gate(tree: Path, seconds: float) -> int:
    """One green ``make test`` in ``tree`` taking ``seconds``, then the gate as ``make test`` runs it.

    The report is shaped the way pytest's ``--junitxml`` writes one: ``time`` on
    the ``testsuite`` element is the session's wall time, and no test failed.
    """
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<testsuites name="pytest tests">'
        f'<testsuite name="pytest" errors="0" failures="0" skipped="0" tests="3" '
        f'time="{seconds:.3f}" timestamp="2026-09-06T12:00:00.000000+00:00" hostname="probe">'
        '<testcase classname="tests.test_probe" name="test_one" time="0.001" />'
        "</testsuite></testsuites>"
    )
    (tree / REPORT_REL).write_text(body, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("check_suite_time_in_tree", tree / GATE_REL)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable gate at {tree / GATE_REL}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    code: int = module.main([])
    return code


# --- 1. a run on another branch does not move this branch's baseline -------------


def test_a_green_run_on_dev_leaves_v2s_baseline_where_v2s_own_last_green_run_put_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    isolate_from_ambient_git(monkeypatch, tmp_path)
    dev = main_checkout_on_dev(tmp_path)
    v2 = worktree_on_v2(dev)
    codes = [
        run_gate(v2, SEED_SECONDS),
        run_gate(dev, FAST_SECONDS),
        run_gate(v2, BETWEEN_SECONDS),
        run_gate(v2, ESCALATED_SECONDS),
    ]
    assert codes == [0, 0, 0, 1]


# --- 2. a branch with no baseline inherits the nearest recorded branch's ---------


def test_a_branch_with_no_baseline_is_judged_against_the_branch_with_fewest_commits_on_head_not_on_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    isolate_from_ambient_git(monkeypatch, tmp_path)
    repo = main_checkout_with_history(tmp_path)
    check_out(repo, "far")
    run_gate(repo, FAR_SECONDS)
    check_out(repo, "near")
    run_gate(repo, SEED_SECONDS)
    check_out(repo, "topic")
    assert run_gate(repo, ESCALATED_SECONDS) == 1


# --- 3. a run deletes the baseline of every branch that no longer exists ---------


def test_a_deleted_branchs_baseline_is_gone_after_a_run_so_a_new_branch_of_that_name_meets_the_nearest_bar_instead(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    isolate_from_ambient_git(monkeypatch, tmp_path)
    repo = main_checkout_on_dev(tmp_path)
    run_gate(repo, SEED_SECONDS)
    check_out(repo, "v2")
    run_gate(repo, BETWEEN_SECONDS)
    check_out(repo, "dev")
    v2_ref = repo / ".git" / "refs" / "heads" / "v2"
    v2_commit = v2_ref.read_text(encoding="utf-8")
    v2_ref.unlink()
    run_gate(repo, FAST_SECONDS)
    v2_ref.write_text(v2_commit, encoding="utf-8")
    check_out(repo, "v2")
    assert run_gate(repo, SEED_SECONDS) == 1
