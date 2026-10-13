"""The config-copies gate holds mutmut's marker expression to the Makefile's.

``scripts/gates/check_config_copies.py`` answers for a repository root: ``check``
returns the exit status, 0 for a pass and nonzero for a refusal. One copy it
guards is the offline marker expression, which the Makefile holds once and
``[tool.mutmut]`` in ``pyproject.toml`` repeats in ``pytest_add_cli_args``.

Every case runs against a private copy of the config files at this checkout's
root, the Makefile copied verbatim, so every copy the gate guards stays as
consistent as the checkout keeps it. Only the ``[tool.mutmut]`` expression is
then set to the one under test, so nothing here reads how the Makefile spells
its offline expression.

The seam is ``check``.
"""

import importlib.util
import json
import tomllib
from pathlib import Path
from types import ModuleType

from narrow import FixtureError

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_config_copies.py"

#: The section header under which mutmut's own pytest arguments sit.
MUTMUT_HEADER = "[tool.mutmut]"

#: The suffixes of the root's tool config files, where a copy of a value can live.
CONFIG_SUFFIXES = frozenset({".toml", ".yaml", ".yml", ".js", ".json", ".cfg", ".ini"})

#: The config files at the checkout's root that every case copies, the Makefile among them.
CONFIG_FILES = sorted(
    path
    for path in REPO_ROOT.iterdir()
    if path.is_file() and not path.is_symlink() and (path.suffix in CONFIG_SUFFIXES or path.name == "Makefile")
)


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_config_copies_markers_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def _mutmut_markers(pyproject_text: str) -> str:
    """The expression that follows ``-m`` in ``[tool.mutmut]``'s pytest arguments."""
    args = tomllib.loads(pyproject_text)["tool"]["mutmut"]["pytest_add_cli_args"]
    if "-m" not in args:
        raise FixtureError(reason="[tool.mutmut] passes pytest no -m")
    return str(args[args.index("-m") + 1])


#: The checkout's own offline marker expression, as mutmut repeats it from the Makefile.
CHECKOUT_MARKERS = _mutmut_markers((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))

#: The checkout's expression with one more clause, so the Makefile's reads inside it.
EXTENDED_MARKERS = f"{CHECKOUT_MARKERS} and not fixture_slow"


def repo_copy(tmp_path: Path, mutmut_markers: str) -> Path:
    """A copy of the checkout's root config files whose ``[tool.mutmut]`` expression is ``mutmut_markers``."""
    root = tmp_path / "repo"
    root.mkdir(parents=True)
    for source in CONFIG_FILES:
        (root / source.name).write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    pyproject = root / "pyproject.toml"
    text = pyproject.read_text(encoding="utf-8")
    start = text.index(MUTMUT_HEADER)
    rewritten = text[:start] + text[start:].replace(json.dumps(CHECKOUT_MARKERS), json.dumps(mutmut_markers), 1)
    if _mutmut_markers(rewritten) != mutmut_markers:
        raise FixtureError(reason="could not rewrite the [tool.mutmut] marker expression")
    pyproject.write_text(rewritten, encoding="utf-8")
    return root


def test_only_the_mutmut_expression_departing_from_the_makefiles_turns_a_pass_into_a_refusal(tmp_path: Path) -> None:
    """The same repository with mutmut agreeing passes, so the refusal's status ranks above its 0."""
    agreeing = GATE.check(repo_copy(tmp_path / "agrees", CHECKOUT_MARKERS))
    assert GATE.check(repo_copy(tmp_path / "differs", EXTENDED_MARKERS)) > agreeing
