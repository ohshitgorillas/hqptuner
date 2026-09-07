"""The gate that reads a spec block's items for the clauses they carry.

``scripts/gates/check_spec_draft.py [--committed] FILE...`` reads a spec block
and prints ``<file>:<line>: <reason>`` to stdout for every item it flags, the
line being the item's own. It exits 1 on any flag and 0 otherwise. In draft
mode it also reports the string shapes the spec-reviewer cuts on sight; under
``--committed`` those word checks are off and only the clause checks run.

Every case writes a block into ``tmp_path`` and observes the exit status and
the line numbers the gate printed for that file; the gate's reasons are never
asserted. Every sentence in the blocks below is invented for this file, and
every block is shaped so that the item lines the spec names fall where it says
they do: a two-item block with items at lines 3 and 7, three clauses each.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_spec_draft.py"


def load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_spec_draft_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(str(GATE_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = load_gate_module()

#: The block header: two lines, so the first item sits at line 3.
_HEADER = ["slug: probe-block", "kind: new"]

#: Item 1 of the clean block. Its ``kills:`` clause carries " and " on purpose:
#: a clause is not an outcome, and the clean block must come back clean.
_ITEM_ONE = [
    "1. The key the caller stored comes back stripped of its surrounding spaces.",
    "   kills: storing the raw key and trimming one space only",
    "   bite: surface new; a stub returning the key untouched fails here.",
    "   existing: none (grep)",
]

#: Item 2 of the clean block.
_ITEM_TWO = [
    "2. The pointer the caller handed in comes back as it went in.",
    "   kills: rewriting the pointer on every store.",
    "   bite: surface new; a stub rewriting the pointer fails here.",
    "   existing: none (grep)",
]

#: The clean block: items at lines 3 and 7, clauses at 4-6 and 8-10.
CLEAN = [*_HEADER, *_ITEM_ONE, *_ITEM_TWO]

#: Item 2's outcome reworded to a two-outcome sentence.
JOINED_OUTCOME = [*_HEADER, *_ITEM_ONE, "2. stores the name and leaves the pointer unchanged", *_ITEM_TWO[1:]]

#: Item 1's ``kills:`` line deleted; item 2 moves up to line 6.
KILLS_DELETED = [*_HEADER, _ITEM_ONE[0], *_ITEM_ONE[2:], *_ITEM_TWO]

#: Item 2's ``existing:`` clause naming a test file, at line 10.
EXISTING_NAMED = [*_HEADER, *_ITEM_ONE, *_ITEM_TWO[:3], "   existing: tests/api/test_x.py"]

#: The clean block with item 1's outcome wrapped over lines 3-5, so its
#: ``kills:`` sits at line 6 and item 2 at line 9.
WRAPPED_OUTCOME = [
    *_HEADER,
    "1. The key the caller stored comes back",
    "   stripped of its surrounding",
    "   spaces.",
    *_ITEM_ONE[1:],
    *_ITEM_TWO,
]

#: One item whose outcome carries " and ", clauses in the order kills, bite, existing.
KILLS_FIRST = [
    *_HEADER,
    "1. The store keeps the name and leaves the pointer as it went in.",
    "   kills: dropping the name on every store.",
    "   bite: surface new; a stub dropping the name fails here.",
    "   existing: none (grep)",
]

#: One item with a plain outcome, clauses in the order bite, kills, existing.
BITE_FIRST = [
    *_HEADER,
    "1. The name the caller stored comes back as it went in.",
    "   bite: surface new; a stub dropping the name fails here.",
    "   kills: dropping the name on every store.",
    "   existing: none (grep)",
]


def write_block(tmp_path: Path, lines: list[str]) -> Path:
    """Write ``lines`` as ``probe-block.txt`` under ``tmp_path`` and return its path."""
    path = tmp_path / "probe-block.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def exit_code(monkeypatch: pytest.MonkeyPatch, *argv: str) -> int:
    """Run the gate's ``main`` with ``argv`` and hand back the exit status it settles on."""
    monkeypatch.setattr(sys, "argv", ["check_spec_draft.py", *argv])
    try:
        returned = GATE.main()
    except SystemExit as stop:
        return int(stop.code or 0)
    return int(returned or 0)


def flagged_lines(stdout: str, path: Path) -> list[int]:
    """The line numbers of every ``<file>:<line>:`` report the gate printed for ``path``."""
    prefix = f"{path}:"
    return [int(line[len(prefix) :].split(":", 1)[0]) for line in stdout.splitlines() if line.startswith(prefix)]


# --- 1. a draft block, flagged at the item lines the sweep names ---------------


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (CLEAN, (0, [])),
        (JOINED_OUTCOME, (1, [7])),
        (KILLS_DELETED, (1, [3])),
        (EXISTING_NAMED, (1, [10])),
        (WRAPPED_OUTCOME, (0, [])),
    ],
    ids=["clean", "joined-outcome", "kills-deleted", "existing-named", "wrapped-outcome"],
)
def test_a_draft_block_exits_and_flags_the_item_lines_the_sweep_names(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    lines: list[str],
    expected: tuple[int, list[int]],
) -> None:
    path = write_block(tmp_path, lines)
    code = exit_code(monkeypatch, str(path))
    assert (code, flagged_lines(capsys.readouterr().out, path)) == expected


# --- 2. draft against --committed on the same file ----------------------------


@pytest.mark.parametrize(
    ("lines", "expected"),
    [(KILLS_FIRST, (1, 0)), (BITE_FIRST, (1, 1))],
    ids=["joined-outcome-kills-first", "plain-outcome-bite-first"],
)
def test_committed_mode_keeps_the_clause_order_check_and_drops_the_word_check(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    lines: list[str],
    expected: tuple[int, int],
) -> None:
    path = write_block(tmp_path, lines)
    draft = exit_code(monkeypatch, str(path))
    committed = exit_code(monkeypatch, "--committed", str(path))
    assert (draft, committed) == expected
