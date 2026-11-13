"""The config-copies gate holds eslint's complexity ceiling equal to ruff's.

``scripts/gates/check_config_copies.py`` holds every copy of a shared config
value equal to its source. Ruff's ``max-complexity`` in ``pyproject.toml`` is
the source; eslint cannot read it, so the ``complexity`` rule in
``eslint.config.js`` is a copy the gate refuses when it differs.

Each case lays out two throwaway roots carrying the repository's own config
files, so every other copy the gate holds stays equal, and sets eslint's
ceiling in each: one at ruff's value, one beside it. Observable contract is the
int exit status ``check(root)`` returns.
"""

import importlib.util
import re
import shutil
import tomllib
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The repository root, found relative to this file.
REPO = Path(__file__).resolve().parents[2]

#: The gate script under test, loaded by path: it lives outside any package.
GATE_PATH = REPO / "scripts" / "gates" / "check_config_copies.py"

#: Config files copied unchanged into each root, so the copies this case does
#: not vary stay as equal as the repository keeps them.
UNCHANGED_CONFIGS = ("pyproject.toml", "Makefile", ".pre-commit-config.yaml", "package.json")

#: The eslint config, copied with its complexity ceiling rewritten.
ESLINT_CONFIG = "eslint.config.js"

#: Eslint's complexity rule as the config writes it, ceiling captured.
ESLINT_COMPLEXITY = re.compile(r'(\bcomplexity:\s*\[\s*"error",\s*)\d+')


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_config_copies_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def ruff_max_complexity() -> int:
    """Ruff's ``max-complexity`` as the repository's ``pyproject.toml`` sets it."""
    with (REPO / "pyproject.toml").open("rb") as handle:
        config = tomllib.load(handle)
    return int(config["tool"]["ruff"]["lint"]["mccabe"]["max-complexity"])


def config_root(root: Path, eslint_complexity: int) -> Path:
    """A root holding the repository's configs, eslint's ceiling set to ``eslint_complexity``."""
    root.mkdir()
    for name in UNCHANGED_CONFIGS:
        shutil.copyfile(REPO / name, root / name)
    source = (REPO / ESLINT_CONFIG).read_text(encoding="utf-8")
    rewritten, count = ESLINT_COMPLEXITY.subn(rf"\g<1>{eslint_complexity}", source)
    if count != 1:
        raise FixtureError(reason=f"{ESLINT_CONFIG} carries {count} complexity rules, expected 1")
    (root / ESLINT_CONFIG).write_text(rewritten, encoding="utf-8")
    return root


@pytest.mark.parametrize("offset", [-1, 1], ids=["below", "above"])
def test_an_eslint_complexity_beside_ruffs_exits_above_one_equal_to_it(tmp_path: Path, offset: int) -> None:
    ceiling = ruff_max_complexity()
    equal = config_root(tmp_path / "equal", ceiling)
    differing = config_root(tmp_path / "differing", ceiling + offset)
    assert GATE.check(differing) > GATE.check(equal)
