"""The gate that refuses a per-field flag naming a store to prefer in the frontend.

``scripts/gates/check_store_flags.py`` scans the text of the files it is handed
and refuses ``fileTruth`` and ``appliesLive`` under ``hqptuner/static/``: the
server says which store answers a field, and the client keeps no copy of that
rule.

The seam is ``main(argv) -> int``: file paths in, one ``<path>:<line>:`` line
per hit out, exit 1 on any hit and 0 on none. Every fixture source sits in
``tests/support/fixtures/store_flags/`` as text, with ``@NAME@`` standing for
the flag a case is about, and is laid down under ``tmp_path`` at the path the
case judges.
"""

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_store_flags.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "store_flags"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_store_flags_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

#: The per-field flags the gate refuses by name.
FLAGS = ["fileTruth", "appliesLive"]

#: Each fixture shape carrying one flag, and the line the flag sits on.
SHAPES = {"lookup.txt": 6, "table.txt": 3}

#: A file the gate judges, by where it sits.
STATIC_FILE = "hqptuner/static/store/settings.js"


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


@pytest.mark.parametrize("name", FLAGS)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_store_flag_under_static_is_refused_at_its_path_and_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], shape: str, name: str
) -> None:
    path = lay(tmp_path, shape, STATIC_FILE, name)
    assert reported_lines(run_gate(capsys, [path])[1], path) == [SHAPES[shape]]


def test_only_a_file_with_a_store_flag_fails_the_gate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    clean = lay(tmp_path, "clean.txt", "hqptuner/static/store/clean.js")
    dirty = lay(tmp_path, "lookup.txt", STATIC_FILE, "appliesLive")
    assert (run_gate(capsys, [clean])[0], run_gate(capsys, [dirty])[0]) == (0, 1)


@pytest.mark.parametrize("relative", ["tests/js/store/settings.test.js", "hqptuner/api/settings.py"])
def test_a_store_flag_outside_static_is_not_reported(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    spared = lay(tmp_path, "lookup.txt", relative, "fileTruth")
    judged = lay(tmp_path, "lookup.txt", STATIC_FILE, "fileTruth")
    output = run_gate(capsys, [spared, judged])[1]
    assert reported_paths(output, {"spared": spared, "judged": judged}) == ["judged"]
