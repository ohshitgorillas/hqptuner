"""``scripts/build_manual.py`` turns the manual's text dump into page-marked sections.

``clean(lines)`` takes the dump's lines and emits them with every page header
replaced by a marker that ``scripts/authority.py`` ``PAGE`` matches, the page
number in group 1. ``split(raw)`` takes the dump and returns
``(entries, front, body)``: the front matter above the first body heading, and
the body from that heading on.

Every dump here is built by hand. A page header is a line ``"      N / M"``; a
bare ``N/M`` cell is table text, not a header. Both scripts live at the repo
root's ``scripts/`` and are not a package, so they are loaded by path.
"""

import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType

import pytest


class FixtureError(Exception):
    """A test's own scaffolding is wrong, not a failure of the behavior under test."""


#: The scripts directory, found relative to this file rather than through an import.
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


def load(name: str, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    """Load ``scripts/<name>.py`` the way ``python scripts/<name>.py`` would see it.

    The scripts directory goes on ``sys.path`` so a sibling import resolves, and the
    module is registered in ``sys.modules`` before it runs, as an ordinary import does.
    """
    monkeypatch.syspath_prepend(str(SCRIPTS_DIR))
    path = SCRIPTS_DIR / f"{name}.py"
    module_name = f"{name}_under_test"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise FixtureError(f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def build_manual(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return load("build_manual", monkeypatch)


@pytest.fixture
def page(monkeypatch: pytest.MonkeyPatch) -> re.Pattern[str]:
    pattern: re.Pattern[str] = load("authority", monkeypatch).PAGE
    return pattern


def filed_under(lines: list[str], number: int, page: re.Pattern[str]) -> list[str]:
    """The lines after the marker for page ``number``, up to the next marker."""
    filed: list[str] = []
    inside = False
    for line in lines:
        mark = page.match(line)
        if mark is not None:
            inside = mark.group(1) == str(number)
            continue
        if inside:
            filed.append(line)
    return filed


def outcome(build_manual: ModuleType, lines: list[str]) -> type:
    """``SystemExit`` when ``clean`` refuses the dump, else the type it returned."""
    try:
        result = build_manual.clean(lines)
    except SystemExit:
        return SystemExit
    return type(result)


def raw(lines: list[str]) -> str:
    return "\n".join(lines) + "\n"


DUMP_A = ["      1 / 3", "a", "      2 / 3", "b", "  5/5", "c", "      3 / 3", "d"]

DUMP_X = [
    "      1 / 3",
    "Cover",
    "      2 / 3",
    "   1. Intro.......3",
    "      3 / 3",
    "1. Intro",
    "Body text",
]

DUMP_Y = [
    "      1 / 3",
    "Cover",
    "   1. Overview.......2",
    "      2 / 3",
    "1. Overview",
    "Text",
    "      3 / 3",
    "More",
]


@pytest.mark.parametrize("cell", ["  5/5", "  3/5", "  5/3"])
def test_bare_fraction_cell_stays_text_under_its_page(
    build_manual: ModuleType, page: re.Pattern[str], cell: str
) -> None:
    dump = ["      1 / 3", "a", "      2 / 3", "b", cell, "c", "      3 / 3", "d"]
    assert filed_under(build_manual.clean(dump), 2, page) == ["b", cell, "c"]


@pytest.mark.parametrize(
    ("dump", "expected"),
    [
        (DUMP_A, list),
        ([line for line in DUMP_A if line != "      2 / 3"], SystemExit),
        ([line for line in DUMP_A if line != "      3 / 3"], SystemExit),
    ],
    ids=["complete", "drop-2", "drop-3"],
)
def test_clean_refuses_a_dump_missing_a_page_header(build_manual: ModuleType, dump: list[str], expected: type) -> None:
    assert outcome(build_manual, dump) is expected


@pytest.mark.parametrize(
    ("dump", "numbers"),
    [(DUMP_X, ["1", "2", "3"]), (DUMP_Y, ["1", "2"])],
    ids=["dump-x", "dump-y"],
)
def test_front_matter_carries_a_marker_for_every_page_above_the_body(
    build_manual: ModuleType, page: re.Pattern[str], dump: list[str], numbers: list[str]
) -> None:
    _, front, _ = build_manual.split(raw(dump))
    marks = [page.match(line) for line in front]
    assert [mark.group(1) for mark in marks if mark is not None] == numbers


@pytest.mark.parametrize(
    ("dump", "heading"),
    [(DUMP_X, "1. Intro"), (DUMP_Y, "1. Overview")],
    ids=["dump-x", "dump-y"],
)
def test_body_opens_at_the_first_body_heading(build_manual: ModuleType, dump: list[str], heading: str) -> None:
    _, _, body = build_manual.split(raw(dump))
    assert (body or [""])[0] == heading
