"""The gate that refuses commit messages narrating how the change came to be.

``scripts/gates/check_commit_msg.py`` reads a commit message and complains
about any scanned line whose prose tells the reader about the process or the
prior iterations rather than the change and its reason. Git's own ``#``
comment lines and the trailing ``Key: value`` trailer block are not scanned.
A line carrying ``history-ok:`` and a stated reason is excused; the pragma
with nothing after it is itself a complaint.

Each case builds one message string and asks the gate about it. The observable
contract is the list ``check_message`` hands back, one entry per refused line,
so every case asserts on its length.

Every phrase this suite feeds the gate lives in a Python string literal, never
in a comment or docstring here, so this file is itself clean by the rule its
sibling gate pins.

The seam is ``check_message(text) -> list[str]``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_commit_msg.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_commit_msg_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK_MESSAGE = GATE.check_message

_SKIPPED_TAIL = (
    "# 2026-07-28 git wrote this line\n"
    "\n"
    "Claude-Session: this session\n"
)


def _message(*scanned: str) -> str:
    body = "\n".join(scanned)
    return "subject: a clean summary\n\nThe tick step rounds up to a round figure.\n" + body + "\n" + _SKIPPED_TAIL


@pytest.mark.parametrize(
    ("scanned", "expected"),
    [
        (("The bar used to sit on the 0 tick.",), 1),
        (("Measured on 2024-03-17 against the live daemon.",), 1),
        (("The bar used to sit on the 0 tick.", "It turned out the step was unrounded."), 2),
    ],
    ids=["phrase", "iso-date", "two-lines"],
)
def test_scanned_lines_are_refused_one_complaint_each_and_skipped_lines_are_not(
    scanned: tuple[str, ...], expected: int
) -> None:
    assert len(CHECK_MESSAGE(_message(*scanned))) == expected


def test_a_reason_excuses_a_line_and_a_bare_pragma_is_itself_a_complaint() -> None:
    text = _message(
        "The bar used to sit on the 0 tick. history-ok: pinned legacy wording",
        "The label used to sit on the 0 tick. history-ok:",
    )
    assert len(CHECK_MESSAGE(text)) == 1
