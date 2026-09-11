"""The hook that keeps the EQ Assistant's session inside the staging tool and its own records.

``.claude/hooks/eq-lane.py`` is a ``PreToolUse`` hook. Its ``verdict`` function
takes the tool name, the tool input and the whole hook payload, and hands back a
reason string to deny the call or ``None`` to allow it. The command string of a
``Bash`` call arrives as ``tool_input["command"]``; the target of a ``Write`` or
an ``Edit`` arrives as ``tool_input["file_path"]``.

Cases build a checkout root ``R`` as ``tmp_path`` with an empty ``.git``
directory inside it, and hand editing tools an absolute path under ``R``.
Command strings are passed as the caller would type them. Observable contract is
the verdict: allowed (``None``) or denied (a string). Nothing here reads the
hook's internals, and no case asserts the wording of a denial.

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
HOOK_PATH = HOOKS_DIR / "eq-lane.py"


def _load_hook_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("eq_lane_under_test", HOOK_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"no importable module at {HOOK_PATH}")
    module = importlib.util.module_from_spec(spec)
    # A hook runs as a script from its own directory, where a sibling module is
    # a plain import; loading it by path here reproduces that.
    if str(HOOKS_DIR) not in sys.path:
        sys.path.insert(0, str(HOOKS_DIR))
    spec.loader.exec_module(module)
    return module


HOOK = _load_hook_module()
VERDICT = HOOK.verdict


def checkout(tmp_path: Path) -> Path:
    """A checkout root: a directory holding an empty ``.git`` directory."""
    (tmp_path / ".git").mkdir()
    return tmp_path


def outcome(tool: str, tool_input: dict[str, str], root: Path) -> str:
    """What the hook does with the call: ``None`` is ``allowed``, a reason string is ``denied``."""
    return "allowed" if VERDICT(tool, tool_input, {"cwd": str(root)}) is None else "denied"


def shell(command: str, root: Path) -> str:
    """The outcome of a shell call carrying ``command``."""
    return outcome("Bash", {"command": command}, root)


def editing(tool: str, relative: str, root: Path) -> str:
    """The outcome of an editing call whose target is ``relative`` under the checkout."""
    return outcome(tool, {"file_path": str(root / relative)}, root)


# --- 1. the shell runs the staging tool, not a script the session wrote -------


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("node scripts/eqstage/eqstage.js", "allowed"),
        ("node /tmp/j.js", "denied"),
    ],
    ids=["staging-tool", "scratch-path"],
)
def test_node_is_permitted_at_the_staging_script_and_refused_at_a_scratch_path(
    tmp_path: Path, command: str, expected: str
) -> None:
    """The interpreter is the same either way; the script it is pointed at decides."""
    assert shell(command, checkout(tmp_path)) == expected


# --- 2. the session edits its records, never the tool it is allowed to run ----


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        ("docs/eq-assistant/sessions/ori/ori3-tuning.json", "allowed"),
        ("scripts/eqstage/eqstage.js", "denied"),
    ],
    ids=["ledger", "staging-tool"],
)
def test_an_edit_is_permitted_at_a_ledger_and_refused_at_the_staging_script(
    tmp_path: Path, relative: str, expected: str
) -> None:
    """An editing tool is ruled on too, so the allowlisted script cannot be rewritten into an apply."""
    assert editing("Edit", relative, checkout(tmp_path)) == expected


# --- 3. the session writes where its records go, not the doctrine it reads ----


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        ("docs/eq-assistant/sessions/ori/notes.md", "allowed"),
        ("docs/eq-assistant/PRIMER.md", "denied"),
    ],
    ids=["session-notes", "primer"],
)
def test_a_write_is_permitted_under_sessions_and_refused_at_the_primer(
    tmp_path: Path, relative: str, expected: str
) -> None:
    """Same tool, same suffix, same top-level directory: the sessions subtree is what admits the write."""
    assert editing("Write", relative, checkout(tmp_path)) == expected


# --- 4. a tool permitted for reading is not permitted for writing ------------


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("sed -n '1,20p' docs/eq-assistant/PRIMER.md", "allowed"),
        ("sed -i 's/x/y/' docs/eq-assistant/PRIMER.md", "denied"),
    ],
    ids=["print-range", "in-place"],
)
def test_sed_is_permitted_printing_and_refused_editing_in_place(tmp_path: Path, command: str, expected: str) -> None:
    """One binary and one path, with the mutating flag as the only difference."""
    assert shell(command, checkout(tmp_path)) == expected
