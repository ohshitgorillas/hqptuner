"""The hook that keeps ``state/reviews/`` the reviewers' lane, and the reviewers in it.

``.claude/hooks/reviews-lane.py`` is a ``PreToolUse`` hook. Its ``verdict``
function takes the tool name, the tool input and the whole hook payload, and
hands back a reason string to deny the call or ``None`` to allow it. The
payload carries ``cwd`` and, for a subagent, ``agent_type``; the orchestrator
has no ``agent_type`` key at all.

Cases build a checkout root ``R`` as ``tmp_path`` with an empty ``.git``
directory inside it, and name ``R/.claude/worktrees/x-spec`` as a worktree of
it by path alone; that tree need not exist. Every path handed to the hook is
absolute under ``R``. Observable contract is the verdict: allowed (``None``)
or denied (a string). Nothing here reads the hook's internals, and no case
asserts the wording of a denial.

The seam is ``verdict(name, tool_input, payload) -> str | None``.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

HOOKS_DIR = REPO_ROOT / ".claude" / "hooks"

#: The hook under test, found relative to this file rather than through an
#: import: it lives in ``.claude/hooks/``, outside any package.
HOOK_PATH = HOOKS_DIR / "reviews-lane.py"


def _load_hook_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("reviews_lane_under_test", HOOK_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {HOOK_PATH}"
    module = importlib.util.module_from_spec(spec)
    # A hook runs as a script from its own directory, where ``free_bash`` is a
    # plain sibling import; loading it by path here reproduces that.
    if str(HOOKS_DIR) not in sys.path:
        sys.path.insert(0, str(HOOKS_DIR))
    spec.loader.exec_module(module)
    return module


HOOK = _load_hook_module()
VERDICT = HOOK.verdict

#: The marker for "no ``agent_type`` key in the payload": the orchestrator.
ORCHESTRATOR = None


def checkout(tmp_path: Path) -> Path:
    """A checkout root: a directory holding an empty ``.git`` directory."""
    (tmp_path / ".git").mkdir()
    return tmp_path


def payload_for(root: Path, agent_type: str | None) -> dict[str, str]:
    """The hook's stdin object: ``cwd`` always, ``agent_type`` only for a subagent."""
    payload = {"cwd": str(root)}
    if agent_type is not None:
        payload["agent_type"] = agent_type
    return payload


def edit_input(tool: str, target: Path) -> dict[str, str]:
    """The tool input an editing tool carries: ``notebook_path`` for notebooks, ``file_path`` otherwise."""
    key = "notebook_path" if tool == "NotebookEdit" else "file_path"
    return {key: str(target)}


def outcome(tool: str, tool_input: dict[str, str], root: Path, agent_type: str | None) -> str:
    """What the hook does with the call: ``None`` is ``allowed``, a reason string is ``denied``."""
    return "allowed" if VERDICT(tool, tool_input, payload_for(root, agent_type)) is None else "denied"


# --- 1. state/reviews/ is written by the two reviewers and nobody else --------


@pytest.mark.parametrize(
    ("agent_type", "tool", "relative", "expected"),
    [
        (ORCHESTRATOR, "Write", "state/reviews/x.1.txt", "denied"),
        ("caveman:cavecrew-builder", "Edit", "state/reviews/x.1.txt", "denied"),
        ("test-writer", "NotebookEdit", ".claude/worktrees/x-spec/state/reviews/x.1.txt", "denied"),
        ("spec-reviewer", "Write", "state/reviews/x.1.txt", "allowed"),
        ("plan-reviewer", "Edit", "state/reviews/x.2.txt", "allowed"),
    ],
    ids=["orchestrator", "builder", "test-writer-in-spec-tree", "spec-reviewer", "plan-reviewer"],
)
def test_a_write_under_state_reviews_is_allowed_only_for_a_reviewer(
    tmp_path: Path, agent_type: str | None, tool: str, relative: str, expected: str
) -> None:
    """The same target flips on the caller: the reviewers are let in, everyone else is kept out."""
    root = checkout(tmp_path)
    assert outcome(tool, edit_input(tool, root / relative), root, agent_type) == expected


# --- 2. a reviewer writes nowhere else ----------------------------------------


@pytest.mark.parametrize(
    ("agent_type", "tool", "relative"),
    [
        ("spec-reviewer", "Write", "hqptuner/core/m.py"),
        ("spec-reviewer", "Edit", "tests/specs/x.txt"),
        ("spec-reviewer", "Write", "docs/testing.md"),
        ("spec-reviewer", "Edit", "state/abuse/current"),
        ("spec-reviewer", "Write", "specs/x.txt"),
        ("plan-reviewer", "Edit", "CLAUDE.md"),
    ],
    ids=["package", "spec-file", "docs", "sibling-state-dir", "bare-specs-dir", "claude-md"],
)
def test_a_reviewer_write_outside_state_reviews_is_denied(
    tmp_path: Path, agent_type: str, tool: str, relative: str
) -> None:
    """A reviewer's lane is ``state/reviews/`` alone; a sibling under ``state/`` or a bare ``specs/`` is outside it."""
    root = checkout(tmp_path)
    assert outcome(tool, edit_input(tool, root / relative), root, agent_type) == "denied"


# --- 3. a reviewer's shell is read-only, whatever it names --------------------


@pytest.mark.parametrize(
    ("agent_type", "command", "expected"),
    [
        ("spec-reviewer", "sed -i 's/a/b/' hqptuner/x.py", "denied"),
        ("spec-reviewer", "echo x > state/reviews/x.1.txt", "denied"),
        ("plan-reviewer", "git commit -m x", "denied"),
        ("spec-reviewer", "make check", "allowed"),
        ("plan-reviewer", "cat state/reviews/x.1.txt", "allowed"),
        ("spec-reviewer", "grep -n READY state/reviews/x.1.txt", "allowed"),
    ],
    ids=["sed-in-place-elsewhere", "redirect-into-lane", "git-commit", "make-check", "cat-lane", "grep-lane"],
)
def test_a_reviewer_bash_is_denied_when_metered_and_allowed_when_free(
    tmp_path: Path, agent_type: str, command: str, expected: str
) -> None:
    """The path a command names is not the test; whether it can change anything is."""
    root = checkout(tmp_path)
    assert outcome("Bash", {"command": command}, root, agent_type) == expected


# --- 4. the orchestrator's shell may read the lane and never write it ---------


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("echo x > state/reviews/x.1.txt", "denied"),
        ("sed -i 's/a/b/' state/reviews/x.1.txt", "denied"),
        ("rm state/reviews/x.1.txt", "denied"),
        ("cat state/reviews/x.1.txt", "allowed"),
        ("sed -i 's/a/b/' hqptuner/x.py", "allowed"),
        ('git commit -m "state/reviews"', "allowed"),
    ],
    ids=[
        "redirect-into-lane",
        "sed-in-place-lane",
        "rm-lane",
        "cat-lane",
        "sed-in-place-elsewhere",
        "commit-naming-lane",
    ],
)
def test_an_orchestrator_bash_is_denied_only_when_it_is_metered_and_names_state_reviews(
    tmp_path: Path, command: str, expected: str
) -> None:
    """Naming the lane is not enough to deny: a read of it is allowed, and a write elsewhere is not its business."""
    root = checkout(tmp_path)
    assert outcome("Bash", {"command": command}, root, ORCHESTRATOR) == expected
