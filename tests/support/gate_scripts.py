"""What the suites of the repository's gate scripts share: loading a gate by path, and the fixture layer under it.

The gate scripts live in ``scripts/gates/``, outside any package, so a suite loads one by path
(``load_gate``). A suite whose gate reads files lays them down under ``tmp_path`` (``write_lines``,
``write_sheet``), and one whose gate reports ``<path>:<line>:`` lines drives it through a ``Gate``
(a ``FixtureGate`` when it also lays the suite's fixture sources down with a name written into them).
"""

import contextlib
import importlib.util
import io
import re
from pathlib import Path
from types import ModuleType

from narrow import FixtureError


def load_gate(path: Path, name: str) -> ModuleType:
    """The gate script at ``path``, imported by path under the module name ``name``."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_lines(root: Path, relative: str, lines: list[str]) -> Path:
    """Write ``lines`` to ``relative`` under ``root`` and return the path."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_sheet(root: Path, directory: str, css: str) -> Path:
    """Write ``css`` to ``region.css`` under ``directory``, relative to ``root``."""
    path = root / directory / "region.css"
    path.parent.mkdir(parents=True)
    path.write_text(css, encoding="utf-8")
    return path


def reported_lines(output: list[str], path: Path) -> list[int]:
    """The line numbers the gate reports for ``path``, sorted."""
    prefix = re.compile(rf"^{re.escape(str(path))}:(\d+):")
    return sorted(int(match.group(1)) for match in map(prefix.match, output) if match)


class Gate:
    """A gate whose ``main(argv) -> int`` reports ``<path>:<line>:`` lines."""

    def __init__(self, gate: ModuleType) -> None:
        self.gate = gate

    def run(self, paths: list[Path]) -> tuple[int, list[str]]:
        """Run the gate on ``paths``; return its exit code and every line it printed, standard output first."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.gate.main([str(path) for path in paths])
        return code, (out.getvalue() + err.getvalue()).splitlines()


class FixtureGate(Gate):
    """A ``Gate`` whose suite lays fixture sources down, with a name written into them, for it to judge."""

    def __init__(self, gate: ModuleType, fixtures: Path) -> None:
        super().__init__(gate)
        self.fixtures = fixtures

    def lay(self, root: Path, fixture: str, relative: str, name: str = "") -> Path:
        """Write ``fixture`` to ``relative`` under ``root`` with ``name`` in place of ``@NAME@``."""
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        text = (self.fixtures / fixture).read_text(encoding="utf-8").replace("@NAME@", name)
        path.write_text(text, encoding="utf-8")
        return path

    def lines_reported(self, root: Path, fixture: str, relative: str, *, name: str) -> list[int]:
        """Lay ``fixture`` at ``relative`` under ``root`` with ``name``, run the gate on it; the lines it reports."""
        path = self.lay(root, fixture, relative, name)
        return reported_lines(self.run([path])[1], path)


def reported_paths(output: list[str], paths: dict[str, Path]) -> list[str]:
    """The keys of ``paths`` the gate reports at least one hit for, in given order."""
    return [key for key, path in paths.items() if reported_lines(output, path)]
