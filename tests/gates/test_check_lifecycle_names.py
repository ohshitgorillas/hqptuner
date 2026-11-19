"""The gate that refuses the lifecycle's retired names and a new event on the manager.

``scripts/gates/check_lifecycle_names.py`` reads the Python files it is handed
as syntax trees and refuses ``reachable``, ``connected``, ``ready``,
``http_ok``, ``connects``, ``drops``, ``drops_at_connect`` and
``restart_landed`` as an attribute, a parameter or a comparand anywhere under
``hqptuner/`` and ``tests/`` except ``hqptuner/core/lifecycle.py``, and any new
``asyncio.Event`` on ``ConnectionManager``. A word inside a string or a comment
is not a hit.

The seam is ``main(argv) -> int``: file paths in, one ``<path>:<line>:`` line
per hit out, exit 1 on any hit and 0 on none. Every fixture source sits in
``tests/support/fixtures/lifecycle_names/`` as text, with ``@NAME@`` standing
for the name a case is about, and is laid down under ``tmp_path`` at the path
the case judges.
"""

from pathlib import Path

import pytest
from gate_scripts import FixtureGate, load_gate, reported_lines, reported_paths

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_lifecycle_names.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "lifecycle_names"


GATE = load_gate(GATE_PATH, "check_lifecycle_names_under_test")

#: The names the gate retires outside the lifecycle module.
RETIRED = ["reachable", "connected", "ready", "http_ok", "connects", "drops", "drops_at_connect", "restart_landed"]

#: Each fixture shape carrying one retired name, and the line the name sits on.
SHAPES = {"attribute.txt": 5, "parameter.txt": 6, "comparand.txt": 9}

#: The line of ``prose.txt`` that reads the name as an attribute; every other
#: mention there is a docstring, a comment or a string.
PROSE_HIT_LINE = 8

#: A file the gate judges, by where it sits.
APP_FILE = "hqptuner/engine/link.py"

#: The one file the retired names may live in.
LIFECYCLE_FILE = "hqptuner/core/lifecycle.py"

#: The file ``ConnectionManager`` lives in.
MANAGER_FILE = "hqptuner/core/manager.py"


RIG = FixtureGate(GATE, FIXTURES)


@pytest.mark.parametrize("name", RETIRED)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_retired_name_is_refused_at_its_path_and_line(tmp_path: Path, shape: str, name: str) -> None:
    assert RIG.lines_reported(tmp_path, shape, APP_FILE, name=name) == [SHAPES[shape]]


def test_only_a_file_with_a_retired_name_fails_the_gate(tmp_path: Path) -> None:
    clean = RIG.lay(tmp_path, "clean.txt", "hqptuner/engine/clean.py")
    dirty = RIG.lay(tmp_path, "attribute.txt", APP_FILE, "drops")
    assert (RIG.run([clean])[0], RIG.run([dirty])[0]) == (0, 1)


@pytest.mark.parametrize("name", RETIRED)
def test_a_retired_name_in_a_docstring_comment_or_string_is_not_a_hit(tmp_path: Path, name: str) -> None:
    path = RIG.lay(tmp_path, "prose.txt", APP_FILE, name)
    assert reported_lines(RIG.run([path])[1], path) == [PROSE_HIT_LINE]


@pytest.mark.parametrize("relative", ["tests/core/test_phase.py", "tests/support/fake_daemon.py"])
def test_a_retired_name_under_tests_is_refused(tmp_path: Path, relative: str) -> None:
    path = RIG.lay(tmp_path, "attribute.txt", relative, "restart_landed")
    assert reported_paths(RIG.run([path])[1], {"test": path}) == ["test"]


@pytest.mark.parametrize(
    ("relative", "reported"),
    [(LIFECYCLE_FILE, ["judged"]), ("hqptuner/engine/lifecycle.py", ["candidate", "judged"])],
    ids=["core-lifecycle", "lifecycle-elsewhere"],
)
def test_only_the_core_lifecycle_module_may_carry_the_retired_names(
    tmp_path: Path, relative: str, reported: list[str]
) -> None:
    candidate = RIG.lay(tmp_path, "attribute.txt", relative, "connected")
    judged = RIG.lay(tmp_path, "attribute.txt", APP_FILE, "connected")
    output = RIG.run([candidate, judged])[1]
    assert reported_paths(output, {"candidate": candidate, "judged": judged}) == reported


@pytest.mark.parametrize(("fixture", "line"), [("event_on_instance.txt", 9), ("event_on_class.txt", 7)])
def test_a_new_asyncio_event_on_the_connection_manager_is_refused_at_its_line(
    tmp_path: Path, fixture: str, line: int
) -> None:
    path = RIG.lay(tmp_path, fixture, MANAGER_FILE)
    assert reported_lines(RIG.run([path])[1], path) == [line]
