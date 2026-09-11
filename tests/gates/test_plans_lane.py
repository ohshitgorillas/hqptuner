"""The lane that holds ``docs/gauntlet/plans/approved/``: written by one reviewer, read by everyone.

The session-wide ``PreToolUse`` chain is what decides here, so every case runs
the whole chain the way Claude Code drives it: each wired script in turn, one
JSON payload on stdin, a JSON object on stdout whose
``hookSpecificOutput.permissionDecision`` is ``deny`` to refuse the call, or no
output at all to let it through. The first refusal any script prints is the
chain's answer; silence from all of them is admission. The chain itself is read
out of ``.claude/settings.json`` rather than named here, so a script added to or
removed from the wiring is part of what these cases observe.

The payload carries ``tool_name``, ``tool_input``, ``cwd`` and
``transcript_path``; a subagent call carries ``agent_type``, and a payload with
no ``agent_type`` key at all is the orchestrator. Cases build a checkout root
``R`` as ``tmp_path`` with an empty ``.git`` directory inside it and name paths
under ``R``. Observable contract is the admission alone, ``allowed`` or
``deny``; no case asserts the wording of a refusal, and no case asserts which
script in the chain produced it.
"""

import contextlib
import io
import json
import runpy
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

HOOKS_DIR = REPO_ROOT / ".claude" / "hooks"

#: Session-wide hook wiring: the ``PreToolUse`` chain every tool call passes.
SETTINGS_PATH = REPO_ROOT / ".claude" / "settings.json"

#: A chain in which every script printed nothing let the call through.
ALLOWED = "allowed"

#: The ``permissionDecision`` value that refuses a call.
DENY = "deny"

#: The marker for "no ``agent_type`` key in the payload": the orchestrator.
ORCHESTRATOR = None

#: The folder an approved stage 1 plan lands in, for a later session to read.
APPROVED = "docs/gauntlet/plans/approved"

#: The folder the orchestrator drafts every plan in, a sibling of the above.
DRAFTS = "docs/gauntlet/plans/drafts"

#: Two names in the lane. The lane is named by its folder, so which file it
#: holds never changes an answer; every case below is run under both.
SLUG = "plans-lane-7c31.txt"
OTHER_SLUG = "reviews-lane-0000.txt"

#: A revision to restore an approved plan from, once one has been overwritten.
REVISION = "abc1234"


def checkout(tmp_path: Path) -> Path:
    """A checkout root: a directory holding an empty ``.git`` directory."""
    (tmp_path / ".git").mkdir()
    return tmp_path


def session_start(tmp_path: Path, rows: list[dict[str, object]]) -> Path:
    """A session transcript file, one JSON row per line, where a hook reads the session from."""
    path = tmp_path / "session.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def call_payload(
    root: Path,
    tool: str,
    tool_input: dict[str, str],
    session: Path,
    agent_type: str | None,
) -> dict[str, str | dict[str, str]]:
    """The stdin object a hook process receives; ``agent_type`` appears only for a subagent."""
    payload: dict[str, str | dict[str, str]] = {
        "tool_name": tool,
        "tool_input": tool_input,
        "cwd": str(root),
        "transcript_path": str(session),
    }
    if agent_type is not None:
        payload["agent_type"] = agent_type
    return payload


def wired_chain(tool: str) -> list[Path]:
    """Every ``PreToolUse`` script a call on ``tool`` passes, in wiring order."""
    wiring = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    scripts: list[Path] = []
    for entry in wiring["hooks"]["PreToolUse"]:
        if tool in str(entry["matcher"]).split("|"):
            scripts.extend(HOOKS_DIR / str(one["command"]).rsplit("/", 1)[-1] for one in entry["hooks"])
    return scripts


def one_verdict(script: Path, payload: dict[str, str | dict[str, str]]) -> str:
    """What a single hook script did with the call: the decision it printed, or ``allowed`` for silence."""
    printed = io.StringIO()
    saved_stdin, saved_argv = sys.stdin, sys.argv
    sys.stdin, sys.argv = io.StringIO(json.dumps(payload)), [str(script)]
    status = 0
    try:
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(io.StringIO()):
            try:
                runpy.run_path(str(script), run_name="__main__")
            except SystemExit as stopped:
                status = int(stopped.code or 0)
    finally:
        sys.stdin, sys.argv = saved_stdin, saved_argv
    spoken = printed.getvalue().strip()
    if status != 0:
        return f"exit-{status}"
    if not spoken:
        return ALLOWED
    return str(json.loads(spoken)["hookSpecificOutput"]["permissionDecision"])


def admission(tool: str, payload: dict[str, str | dict[str, str]]) -> str:
    """The chain's answer: the first refusal any script in it printed, or ``allowed``."""
    for script in wired_chain(tool):
        spoken = one_verdict(script, payload)
        if spoken != ALLOWED:
            return spoken
    return ALLOWED


def writing(tmp_path: Path, relative: str, agent_type: str | None) -> str:
    """How the chain answers a ``Write`` of ``relative`` under a fresh checkout by that caller."""
    root = checkout(tmp_path)
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    fresh = session_start(tmp_path, [{"message": {"role": "user", "content": "hi"}}])
    return admission("Write", call_payload(root, "Write", {"file_path": str(target)}, fresh, agent_type))


# --- 1. the approved plans lane is written by the prosecuting reviewer alone ---


@pytest.mark.parametrize(
    ("agent_type", "name", "expected"),
    [
        ("gauntlet-prosecutor", SLUG, ALLOWED),
        ("gauntlet-prosecutor", OTHER_SLUG, ALLOWED),
        (ORCHESTRATOR, SLUG, DENY),
        (ORCHESTRATOR, OTHER_SLUG, DENY),
        ("gauntlet-arbiter", SLUG, DENY),
        ("gauntlet-testsmith", OTHER_SLUG, DENY),
        ("prosecutor", SLUG, DENY),
        ("prosecutor", OTHER_SLUG, DENY),
    ],
    ids=[
        "prosecutor",
        "prosecutor-other-file",
        "orchestrator",
        "orchestrator-other-file",
        "arbiter",
        "testsmith",
        "near-miss-name",
        "near-miss-name-other-file",
    ],
)
def test_a_write_under_plans_approved_is_admitted_only_for_the_prosecuting_reviewer(
    tmp_path: Path, agent_type: str | None, name: str, expected: str
) -> None:
    """One caller is admitted to the folder and every other is refused, whatever the file is called."""
    assert writing(tmp_path, f"{APPROVED}/{name}", agent_type) == expected


# --- 2. the orchestrator keeps its drafts folder and loses the approved one ---


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        (f"{DRAFTS}/{SLUG}", ALLOWED),
        (f"{DRAFTS}/{OTHER_SLUG}", ALLOWED),
        (f"{APPROVED}/{SLUG}", DENY),
        (f"{APPROVED}/{OTHER_SLUG}", DENY),
    ],
    ids=["drafts", "drafts-other-file", "approved", "approved-other-file"],
)
def test_the_orchestrator_still_writes_plan_drafts_where_it_is_refused_the_approved_folder(
    tmp_path: Path, relative: str, expected: str
) -> None:
    """The two sibling folders answer the same caller differently, for any file name in either."""
    assert writing(tmp_path, relative, ORCHESTRATOR) == expected


# --- 3. the shell may read the approved plan and may not overwrite it ---------


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        (f"rm {APPROVED}/{SLUG}", DENY),
        (f"rm {APPROVED}/{OTHER_SLUG}", DENY),
        (f"mv /tmp/x.txt {APPROVED}/{SLUG}", DENY),
        (f"mv /tmp/x.txt {APPROVED}/{OTHER_SLUG}", DENY),
        (f"cat {APPROVED}/{SLUG}", ALLOWED),
        (f"cat {APPROVED}/{OTHER_SLUG}", ALLOWED),
        (f"git restore --source {REVISION} -- {APPROVED}/{SLUG}", ALLOWED),
        (f"git restore --source {REVISION} -- {APPROVED}/{OTHER_SLUG}", ALLOWED),
    ],
    ids=[
        "rm",
        "rm-other-file",
        "mv-onto",
        "mv-onto-other-file",
        "cat",
        "cat-other-file",
        "git-restore",
        "git-restore-other-file",
    ],
)
def test_a_shell_command_naming_an_approved_plan_is_refused_to_write_it_and_admitted_to_read_it(
    tmp_path: Path, command: str, expected: str
) -> None:
    """Naming the lane does not decide: the two writes die where the two reads go through."""
    root = checkout(tmp_path)
    fresh = session_start(tmp_path, [])
    assert admission("Bash", call_payload(root, "Bash", {"command": command}, fresh, ORCHESTRATOR)) == expected
