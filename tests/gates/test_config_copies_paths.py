"""The config-copies gate holds pytest's ``pythonpath`` equal to mypy's ``mypy_path``.

``scripts/gates/check_config_copies.py`` holds every config value that more than
one tool needs, and cannot read from one source, equal across its copies. Both
pytest and mypy import the support modules by bare name, so each keeps its own
list of import roots in ``pyproject.toml``; a root one list has and the other
lacks is a module that type-checks and fails to import, or the reverse.

Cases lay a fixture checkout down under ``tmp_path``: this checkout's own config
files, with pytest's ``pythonpath`` rewritten to the list the case is about, so
every other copy the gate holds is the one the real repository ships. The
observable contract is the exit status ``check(root)`` returns for that root.

The seam is ``check(root) -> int``.
"""

import importlib.util
import json
import re
import tomllib
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_config_copies.py"

#: The config files a fixture checkout carries, copied from this one.
CONFIG_FILES = ("pyproject.toml", "Makefile", ".pre-commit-config.yaml", "eslint.config.js", "package.json")

#: The one ``pythonpath = [...]`` assignment in ``pyproject.toml``.
PYTHONPATH_LINE = re.compile(r"^pythonpath = \[[^\]]*\]", re.MULTILINE)

#: An import root no checkout of this repository has, for a list to carry extra.
EXTRA_ROOT = "tests/fixture_only_root"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_config_copies_paths_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check

#: The shipped ``pyproject.toml``, the base every fixture rewrites.
SHIPPED_PYPROJECT = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")

#: The shipped ``mypy_path``, the list each case's ``pythonpath`` is measured against.
MYPY_PATH: list[str] = tomllib.loads(SHIPPED_PYPROJECT)["tool"]["mypy"]["mypy_path"]


def with_pythonpath(pyproject: str, roots: list[str]) -> str:
    """``pyproject`` with pytest's ``pythonpath`` replaced by ``roots``."""
    rewritten, count = PYTHONPATH_LINE.subn(lambda _match: f"pythonpath = {json.dumps(roots)}", pyproject)
    if count != 1:
        raise FixtureError(reason=f"expected one pythonpath assignment in pyproject.toml, found {count}")
    return rewritten


def fixture_checkout(root: Path, pythonpath: list[str]) -> Path:
    """Lay this checkout's config files down under ``root`` with ``pythonpath`` set to the list given."""
    for name in CONFIG_FILES:
        (root / name).write_text((REPO_ROOT / name).read_text(encoding="utf-8"), encoding="utf-8")
    (root / "pyproject.toml").write_text(with_pythonpath(SHIPPED_PYPROJECT, pythonpath), encoding="utf-8")
    return root


def exit_shape(code: int) -> str:
    """``"clean"`` for a zero exit status, ``"refused"`` for any nonzero one."""
    return "clean" if code == 0 else "refused"


@pytest.mark.parametrize(
    ("pythonpath", "shape"),
    [
        (MYPY_PATH, "clean"),
        (MYPY_PATH[:-1], "refused"),
        ([*MYPY_PATH, EXTRA_ROOT], "refused"),
    ],
    ids=["equal to mypy_path", "missing a mypy_path root", "carrying a root mypy_path lacks"],
)
def test_a_pytest_pythonpath_that_differs_from_mypy_path_is_refused(
    tmp_path: Path, pythonpath: list[str], shape: str
) -> None:
    """Equal lists pass; a root on one side only, in either direction, fails the gate."""
    assert exit_shape(CHECK(fixture_checkout(tmp_path, pythonpath))) == shape
