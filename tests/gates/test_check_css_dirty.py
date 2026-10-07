"""The gate that holds every dirty-row producer to a stylesheet marker.

``scripts/gates/css/check_css_dirty.py`` reads the frontend's JS sources and
its stylesheets, and reports every element a template renders with a
``data-dirty=`` attribute whose class no compound selector pairs with
``[data-dirty]``.

The seam is ``unmarked(js, css) -> list[tuple[str, int, str]]``; the
observable contract is the ``(path, line, class)`` triples it hands back. Every
path, class name and rule below is invented here.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/css/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "css" / "check_css_dirty.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_css_dirty_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


#: The JS path every single-file case is keyed by.
SOURCE = "a.js"

#: A one-line producer of class ``drow``.
DROW = '<div class="drow" data-dirty=${d ? "" : undefined}>'

#: A one-line producer of class ``dcell``.
DCELL = '<span class="dcell" data-dirty=${d ? "" : undefined}>'

#: No stylesheet at all.
NO_CSS = ""


def test_an_unmarked_producer_is_reported_with_its_path_line_and_class() -> None:
    """A producer no stylesheet marks comes back as one triple."""
    assert GATE.unmarked({SOURCE: DROW}, NO_CSS) == [(SOURCE, 1, "drow")]


@pytest.mark.parametrize(
    "css",
    [
        '.drow[data-dirty]::after{content:""}',
        ".drow[data-dirty]{outline:0}",
        "div.drow[data-dirty]{outline:0}",
        ".other,.drow[data-dirty]{outline:0}",
    ],
)
def test_a_compound_selector_pairing_the_class_with_data_dirty_marks_that_producer_only(css: str) -> None:
    """The marked producer drops out and its unmarked neighbour stays."""
    result = GATE.unmarked({SOURCE: f"{DROW}\n{DCELL}"}, css)
    assert [cls for _, _, cls in result] == ["dcell"]


def test_a_tag_spanning_lines_reports_the_line_of_its_opening_bracket() -> None:
    """The opening ``<`` sits on line 2; ``data-dirty`` sits on line 4."""
    source = 'const row = (d) => html`\n<div\n  class="drow"\n  data-dirty=${d ? "" : undefined}\n>`;\n'
    assert [line for _, line, _ in GATE.unmarked({SOURCE: source}, NO_CSS)] == [2]


@pytest.mark.parametrize(
    "css",
    [
        ".drow [data-dirty]{outline:0}",
        ".drow > [data-dirty]{outline:0}",
        ".drow{outline:0}[data-dirty]{outline:0}",
    ],
)
def test_a_selector_not_pairing_class_and_data_dirty_in_one_compound_leaves_the_producer_unmarked(css: str) -> None:
    """A descendant, a child or two separate rules do not mark the producer."""
    assert GATE.unmarked({SOURCE: DROW}, css) == [(SOURCE, 1, "drow")]


def test_a_longer_class_sharing_the_prefix_does_not_mark_the_producer() -> None:
    """``.drowx[data-dirty]`` names another class, not ``drow``."""
    assert GATE.unmarked({SOURCE: DROW}, ".drowx[data-dirty]{outline:0}") == [(SOURCE, 1, "drow")]


def test_a_tag_without_data_dirty_is_no_producer() -> None:
    """Only the tag carrying ``data-dirty=`` is reported."""
    source = f'<div class="plain">\n{DROW}'
    assert [cls for _, _, cls in GATE.unmarked({SOURCE: source}, NO_CSS)] == ["drow"]


def test_a_producer_keys_on_the_first_token_of_its_class_attribute() -> None:
    """``class="drow wide"`` is the ``drow`` producer."""
    source = '<div class="drow wide" data-dirty=${d ? "" : undefined}>'
    assert [cls for _, _, cls in GATE.unmarked({SOURCE: source}, NO_CSS)] == ["drow"]


def test_the_class_comes_from_the_tag_carrying_data_dirty_not_a_neighbour_on_its_line() -> None:
    """A plain tag earlier on the same line lends the producer nothing."""
    source = f'<span class="label"></span>{DROW}'
    assert [cls for _, _, cls in GATE.unmarked({SOURCE: source}, NO_CSS)] == ["drow"]


def test_unmarked_producers_come_back_in_source_order() -> None:
    """``zrow`` on line 1 precedes ``arow`` on line 3, against the alphabet."""
    source = (
        '<div class="zrow" data-dirty=${d ? "" : undefined}>\n'
        "\n"
        '<div class="arow" data-dirty=${d ? "" : undefined}>'
    )
    assert [cls for _, _, cls in GATE.unmarked({SOURCE: source}, NO_CSS)] == ["zrow", "arow"]


def test_each_producer_is_reported_under_the_path_of_its_own_file() -> None:
    """Two files, one producer each, each keyed by its own path."""
    result = GATE.unmarked({"a.js": DROW, "b.js": DCELL}, NO_CSS)
    assert {(path, cls) for path, _, cls in result} == {("a.js", "drow"), ("b.js", "dcell")}
