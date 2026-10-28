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

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_lifecycle_names.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "lifecycle_names"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_lifecycle_names_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

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


@pytest.mark.parametrize("name", RETIRED)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_retired_name_is_refused_at_its_path_and_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], shape: str, name: str
) -> None:
    path = lay(tmp_path, shape, APP_FILE, name)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [SHAPES[shape]]


def test_only_a_file_with_a_retired_name_fails_the_gate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    clean = lay(tmp_path, "clean.txt", "hqptuner/engine/clean.py")
    dirty = lay(tmp_path, "attribute.txt", APP_FILE, "drops")
    assert (run_gate(capsys, [clean])[0], run_gate(capsys, [dirty])[0]) == (0, 1)


@pytest.mark.parametrize("name", RETIRED)
def test_a_retired_name_in_a_docstring_comment_or_string_is_not_a_hit(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], name: str
) -> None:
    path = lay(tmp_path, "prose.txt", APP_FILE, name)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [PROSE_HIT_LINE]


@pytest.mark.parametrize("relative", ["tests/core/test_phase.py", "tests/support/fake_daemon.py"])
def test_a_retired_name_under_tests_is_refused(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    path = lay(tmp_path, "attribute.txt", relative, "restart_landed")
    assert reported_paths(run_gate(capsys, [path])[1], {"test": path}) == ["test"]


@pytest.mark.parametrize(
    ("relative", "reported"),
    [(LIFECYCLE_FILE, ["judged"]), ("hqptuner/engine/lifecycle.py", ["candidate", "judged"])],
    ids=["core-lifecycle", "lifecycle-elsewhere"],
)
def test_only_the_core_lifecycle_module_may_carry_the_retired_names(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str, reported: list[str]
) -> None:
    candidate = lay(tmp_path, "attribute.txt", relative, "connected")
    judged = lay(tmp_path, "attribute.txt", APP_FILE, "connected")
    output = run_gate(capsys, [candidate, judged])[1]
    assert reported_paths(output, {"candidate": candidate, "judged": judged}) == reported


@pytest.mark.parametrize(("fixture", "line"), [("event_on_instance.txt", 9), ("event_on_class.txt", 7)])
def test_a_new_asyncio_event_on_the_connection_manager_is_refused_at_its_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], fixture: str, line: int
) -> None:
    path = lay(tmp_path, fixture, MANAGER_FILE)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [line]
