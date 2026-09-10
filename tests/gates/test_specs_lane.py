"""The lanes that decide which agent may write a test, write a spec block, or spend a budget slot.

Three ``PreToolUse`` hooks are exercised here the way Claude Code drives them:
as a script, one JSON payload on stdin, a JSON object on stdout whose
``hookSpecificOutput.permissionDecision`` is ``deny`` to refuse the call, or
nothing at all to let it through. The payload carries ``tool_name``,
``tool_input`` and ``cwd``; a subagent call carries ``agent_type``, and an
``Agent`` spawn names the callee in ``tool_input.subagent_type``. A payload with
no ``agent_type`` key is the main agent.

``.claude/hooks/tests-lane.py`` and the session-wide chain are driven through
that script interface rather than an imported function: the first has no public
verdict function, and the second is a list of scripts, not a call. Each is run
with ``runpy`` under a redirected stdin and stdout, which is what a hook process
sees.

Cases build a checkout root ``R`` as ``tmp_path`` with an empty ``.git``
directory inside it, and name ``R/.claude/worktrees/x-spec`` as a worktree of it
by path. Observable contract is the admission: ``allowed`` (no output) or
``deny`` (the decision the hook printed). No case asserts the wording of a
denial.
"""

import contextlib
import importlib.util
import io
import json
import runpy
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

HOOKS_DIR = REPO_ROOT / ".claude" / "hooks"

#: Session-wide hook wiring: the ``PreToolUse`` chain every tool call passes.
SETTINGS_PATH = REPO_ROOT / ".claude" / "settings.json"

TESTS_LANE = HOOKS_DIR / "tests-lane.py"

CHANGE_BUDGET = HOOKS_DIR / "change-budget.py"

#: A hook that printed nothing let the call through.
ALLOWED = "allowed"

#: The ``permissionDecision`` value that refuses a call.
DENY = "deny"

#: The marker for "no ``agent_type`` key in the payload": the main agent.
MAIN_AGENT = None


def _load_selftest() -> ModuleType:
    """``budget_selftest``, which reads the budget's limit back off the hook it exercises."""
    path = HOOKS_DIR / "budget_selftest.py"
    spec = importlib.util.spec_from_file_location("budget_selftest_under_test", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    # A hook runs as a script from its own directory, where its siblings are
    # plain imports; putting that directory on the path here reproduces it.
    if str(HOOKS_DIR) not in sys.path:
        sys.path.insert(0, str(HOOKS_DIR))
    spec.loader.exec_module(module)
    return module


SELFTEST = _load_selftest()

#: How many metered actions the budget allows between two turns of the user's prose.
CHANGE_LIMIT = int(SELFTEST.CHANGE_LIMIT)


def checkout(tmp_path: Path) -> Path:
    """A checkout root: a directory holding an empty ``.git`` directory."""
    (tmp_path / ".git").mkdir()
    return tmp_path


def spoke(text: str) -> dict[str, object]:
    """A transcript row for the user typing prose."""
    return {"message": {"role": "user", "content": text}}


def metered(count: int) -> list[dict[str, object]]:
    """``count`` completed metered Bash calls, each with its result already recorded."""
    rows: list[dict[str, object]] = []
    for i in range(count):
        call = {"type": "tool_use", "id": f"t{i}", "name": "Bash", "input": {"command": f"sudo ls {i}"}}
        rows.append({"uuid": f"a{i}", "message": {"role": "assistant", "content": [call]}})
        result = {"type": "tool_result", "tool_use_id": f"t{i}", "content": "ok"}
        rows.append({"message": {"role": "user", "content": [result]}})
    return rows


def transcript(tmp_path: Path, rows: list[dict[str, object]]) -> Path:
    """A session transcript, one JSON row per line, where the hook reads the session from."""
    path = tmp_path / "transcript.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def payload_for(
    root: Path,
    tool: str,
    tool_input: dict[str, str],
    transcript_path: Path,
    agent_type: str | None,
) -> dict[str, str | dict[str, str]]:
    """The hook's stdin object; ``agent_type`` appears only for a subagent call."""
    payload: dict[str, str | dict[str, str]] = {
        "tool_name": tool,
        "tool_input": tool_input,
        "cwd": str(root),
        "transcript_path": str(transcript_path),
    }
    if agent_type is not None:
        payload["agent_type"] = agent_type
    return payload


def decision(hook: Path, payload: dict[str, str | dict[str, str]], expect_exit: int = 0) -> str:
    """What one hook did with the call: its printed decision, or ``allowed`` for silence."""
    printed = io.StringIO()
    saved_stdin, saved_argv = sys.stdin, sys.argv
    sys.stdin, sys.argv = io.StringIO(json.dumps(payload)), [str(hook)]
    status = 0
    try:
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(io.StringIO()):
            try:
                runpy.run_path(str(hook), run_name="__main__")
            except SystemExit as stopped:
                status = int(stopped.code or 0)
    finally:
        sys.stdin, sys.argv = saved_stdin, saved_argv
    if status != expect_exit:
        return f"exit-{status}"
    output = printed.getvalue().strip()
    if not output:
        return ALLOWED
    return str(json.loads(output)["hookSpecificOutput"]["permissionDecision"])


def session_hooks(tool: str) -> list[Path]:
    """The session-wide ``PreToolUse`` chain a call on ``tool`` passes, in wiring order."""
    wiring = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    hooks: list[Path] = []
    for entry in wiring["hooks"]["PreToolUse"]:
        if tool in str(entry["matcher"]).split("|"):
            hooks.extend(HOOKS_DIR / str(one["command"]).rsplit("/", 1)[-1] for one in entry["hooks"])
    return hooks


def chain_decision(tool: str, payload: dict[str, str | dict[str, str]]) -> str:
    """The chain's admission: the first refusal any hook in it printed, or ``allowed``."""
    for hook in session_hooks(tool):
        verdict = decision(hook, payload)
        if verdict != ALLOWED:
            return verdict
    return ALLOWED


# --- 2. tests/ in a spec tree belongs to the test-writing agent ---------------


SPEC_TREE_TEST = ".claude/worktrees/x-spec/tests/t.py"


@pytest.mark.parametrize(
    ("agent_type", "relative", "expected"),
    [
        ("testsmith", SPEC_TREE_TEST, ALLOWED),
        ("test-writer", SPEC_TREE_TEST, DENY),
        ("testsmith", "hqptuner/x.py", DENY),
    ],
    ids=["testsmith-in-lane", "retired-writer-name-in-lane", "testsmith-outside-lane"],
)
def test_a_write_under_a_spec_trees_tests_is_admitted_only_for_the_test_writing_agent(
    tmp_path: Path, agent_type: str, relative: str, expected: str
) -> None:
    """Admission flips on the caller with the target held, and on the target with the caller held."""
    root = checkout(tmp_path)
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    fresh = transcript(tmp_path, [spoke("hi")])
    call = payload_for(root, "Write", {"file_path": str(target)}, fresh, agent_type)
    assert decision(TESTS_LANE, call) == expected


# --- 3. specs/approved/ is written by the reviewing agent and nobody else -----


APPROVED_BLOCK = "specs/approved/x.txt"


@pytest.mark.parametrize(
    ("agent_type", "relative", "expected"),
    [
        ("arbiter", APPROVED_BLOCK, ALLOWED),
        ("testsmith", APPROVED_BLOCK, DENY),
        (MAIN_AGENT, APPROVED_BLOCK, DENY),
        ("arbiter", "specs/x.txt", DENY),
    ],
    ids=["arbiter-in-lane", "testsmith-in-lane", "main-agent-in-lane", "arbiter-outside-lane"],
)
def test_a_write_under_specs_approved_is_admitted_only_for_the_reviewing_agent(
    tmp_path: Path, agent_type: str | None, relative: str, expected: str
) -> None:
    """Neither the caller nor the path decides alone: the reviewer is admitted to that lane and no other."""
    root = checkout(tmp_path)
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    fresh = transcript(tmp_path, [spoke("hi")])
    call = payload_for(root, "Write", {"file_path": str(target)}, fresh, agent_type)
    assert chain_decision("Write", call) == expected


# --- 5. a read-only spawn is never charged a budget slot ---------------------


@pytest.mark.parametrize(
    ("subagent_type", "expected"),
    [
        ("detective", ALLOWED),
        ("prosecutor", ALLOWED),
        ("general-purpose", DENY),
    ],
    ids=["detective", "prosecutor", "general-purpose"],
)
def test_a_free_agent_spawn_is_admitted_past_the_change_budget(
    tmp_path: Path, subagent_type: str, expected: str
) -> None:
    """Past the limit the callee decides: the free ones go through, an arbitrary one does not."""
    spent = transcript(tmp_path, [spoke("hi"), *metered(CHANGE_LIMIT + 5)])
    spawn = payload_for(REPO_ROOT, "Agent", {"subagent_type": subagent_type, "prompt": "go"}, spent, MAIN_AGENT)
    assert decision(CHANGE_BUDGET, spawn) == expected
