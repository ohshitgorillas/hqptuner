"""The structure gate's refusal of a loop over an Engine enumeration list outside the Engine view.

``scripts/gates/check_field_structure.py`` reads the Python files it is handed
as syntax trees. An enumeration list is one of the five lists a reading holds
under ``enums``: ``modes``, ``filters``, ``shapers``, ``rates`` and
``junk_filters``. Iterating one is refused in every file but
``hqptuner/engine/view.py``, where the same iteration is allowed. Reading a list
without iterating it, and iterating anything else, is not a hit.

The seam is ``main(argv) -> int``: file paths in, one ``<path>:<line>:`` line
per hit out, exit 1 on any hit and 0 on none. Every fixture source sits in
``tests/support/fixtures/enumeration_loops/`` as text, with ``@NAME@`` standing
for the enumeration a case is about, and is laid down under ``tmp_path`` at the
path the case judges.
"""

from pathlib import Path

import pytest
from gate_scripts import FixtureGate, load_gate, reported_lines, reported_paths

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_field_structure.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "enumeration_loops"


GATE = load_gate(GATE_PATH, "check_field_structure_enumerations_under_test")

#: The Engine's enumeration lists, by the key a reading holds each under in ``enums``.
ENUMERATIONS = ["modes", "filters", "shapers", "rates", "junk_filters"]

#: Each fixture shape iterating one enumeration list, and the line the iteration sits on.
SHAPES = {"for_statement.txt": 7, "list_comprehension.txt": 5, "generator.txt": 10}

#: The lines of ``two_loops.txt`` that each iterate an enumeration list.
TWO_LOOP_LINES = [6, 12]

#: The line of ``held_not_iterated.txt`` that iterates an enumeration list; every
#: other read of ``enums`` there only holds a list, and every other loop walks
#: something else.
HELD_HIT_LINE = 12

#: A file the gate judges, by where it sits.
APP_FILE = "hqptuner/lanes/live/overrides.py"

#: The one file an enumeration list may be iterated in.
VIEW_FILE = "hqptuner/engine/view.py"


RIG = FixtureGate(GATE, FIXTURES)


@pytest.mark.parametrize("name", ENUMERATIONS)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_loop_over_an_enumeration_list_is_refused_at_its_path_and_line(tmp_path: Path, shape: str, name: str) -> None:
    assert RIG.lines_reported(tmp_path, shape, APP_FILE, name=name) == [SHAPES[shape]]


def test_only_a_file_with_a_loop_over_an_enumeration_list_fails_the_gate(tmp_path: Path) -> None:
    clean = RIG.lay(tmp_path, "clean.txt", "hqptuner/lanes/live/clean.py")
    dirty = RIG.lay(tmp_path, "for_statement.txt", APP_FILE, "filters")
    assert (RIG.run([clean])[0], RIG.run([dirty])[0]) == (0, 1)


def test_each_loop_over_an_enumeration_list_in_one_file_is_its_own_problem(tmp_path: Path) -> None:
    path = RIG.lay(tmp_path, "two_loops.txt", APP_FILE)
    assert reported_lines(RIG.run([path])[1], path) == TWO_LOOP_LINES


def test_holding_an_enumeration_list_or_looping_over_anything_else_is_not_a_hit(tmp_path: Path) -> None:
    path = RIG.lay(tmp_path, "held_not_iterated.txt", APP_FILE)
    assert reported_lines(RIG.run([path])[1], path) == [HELD_HIT_LINE]


@pytest.mark.parametrize(
    ("relative", "reported"),
    [(VIEW_FILE, ["judged"]), ("hqptuner/lanes/view.py", ["candidate", "judged"])],
    ids=["engine-view", "view-elsewhere"],
)
def test_only_the_engine_view_module_may_loop_over_an_enumeration_list(
    tmp_path: Path, relative: str, reported: list[str]
) -> None:
    candidate = RIG.lay(tmp_path, "for_statement.txt", relative, "filters")
    judged = RIG.lay(tmp_path, "for_statement.txt", APP_FILE, "filters")
    output = RIG.run([candidate, judged])[1]
    assert reported_paths(output, {"candidate": candidate, "judged": judged}) == reported
