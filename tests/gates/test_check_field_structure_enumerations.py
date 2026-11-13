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

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_field_structure.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "enumeration_loops"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_field_structure_enumerations_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

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


def lay(root: Path, fixture: str, relative: str, name: str = "") -> Path:
    """Write ``fixture`` to ``relative`` under ``root`` with ``name`` in place of ``@NAME@``."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text((FIXTURES / fixture).read_text(encoding="utf-8").replace("@NAME@", name), encoding="utf-8")
    return path


def run_gate(capsys: pytest.CaptureFixture[str], paths: list[Path]) -> tuple[int, list[str]]:
    """Run the gate on ``paths``; return its exit code and every line it printed."""
    code = GATE.main([str(path) for path in paths])
    captured = capsys.readouterr()
    return code, (captured.out + captured.err).splitlines()


def reported_lines(output: list[str], path: Path) -> list[int]:
    """The line numbers the gate reports for ``path``, sorted."""
    prefix = re.compile(rf"^{re.escape(str(path))}:(\d+):")
    return sorted(int(match.group(1)) for match in map(prefix.match, output) if match)


def reported_paths(output: list[str], paths: dict[str, Path]) -> list[str]:
    """The keys of ``paths`` the gate reports at least one hit for, in given order."""
    return [key for key, path in paths.items() if reported_lines(output, path)]


@pytest.mark.parametrize("name", ENUMERATIONS)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_loop_over_an_enumeration_list_is_refused_at_its_path_and_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], shape: str, name: str
) -> None:
    path = lay(tmp_path, shape, APP_FILE, name)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [SHAPES[shape]]


def test_only_a_file_with_a_loop_over_an_enumeration_list_fails_the_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    clean = lay(tmp_path, "clean.txt", "hqptuner/lanes/live/clean.py")
    dirty = lay(tmp_path, "for_statement.txt", APP_FILE, "filters")
    assert (run_gate(capsys, [clean])[0], run_gate(capsys, [dirty])[0]) == (0, 1)


def test_each_loop_over_an_enumeration_list_in_one_file_is_its_own_problem(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = lay(tmp_path, "two_loops.txt", APP_FILE)
    assert reported_lines(run_gate(capsys, [path])[1], path) == TWO_LOOP_LINES


def test_holding_an_enumeration_list_or_looping_over_anything_else_is_not_a_hit(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = lay(tmp_path, "held_not_iterated.txt", APP_FILE)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [HELD_HIT_LINE]


@pytest.mark.parametrize(
    ("relative", "reported"),
    [(VIEW_FILE, ["judged"]), ("hqptuner/lanes/view.py", ["candidate", "judged"])],
    ids=["engine-view", "view-elsewhere"],
)
def test_only_the_engine_view_module_may_loop_over_an_enumeration_list(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str, reported: list[str]
) -> None:
    candidate = lay(tmp_path, "for_statement.txt", relative, "filters")
    judged = lay(tmp_path, "for_statement.txt", APP_FILE, "filters")
    output = run_gate(capsys, [candidate, judged])[1]
    assert reported_paths(output, {"candidate": candidate, "judged": judged}) == reported
