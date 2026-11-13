"""The config-copies gate holds xenon's grade to ruff's complexity limit.

``scripts/gates/check_config_copies.py`` holds every copy of a shared config
value equal to its source. One such copy is xenon's ``--max-absolute`` grade,
written in the ``Makefile`` and in ``.pre-commit-config.yaml``: a grade is
radon's name for a band of cyclomatic complexity, so it stands for the band's
ceiling, and that ceiling must equal ruff's ``max-complexity`` in
``pyproject.toml``.

The ceilings come from radon's documented rank table (``radon.complexity.cc_rank``):
A is 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41 and up, so F has no ceiling.

These cases build a throwaway repository root in which every other copy the
gate holds already agrees with its source, so the xenon grade is the only
thing a case varies. Observable contract is the int exit status ``check(root)``
returns; nothing here reads the gate's internals.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_config_copies.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_config_copies_xenon_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check

#: Ruff limits that sit on a radon band's ceiling: B tops out at 10, C at 20.
LIMIT_AT_B_CEILING = 10
LIMIT_AT_C_CEILING = 20

#: A ruff limit inside band C (11-20) but on no band's ceiling, so no grade spells it.
LIMIT_ON_NO_CEILING = 12

#: The exit status of a gate that passes.
PASSED = 0


def pyproject(limit: int) -> str:
    """A pyproject carrying ruff's limit and agreeing pytest, mypy and mutmut copies."""
    return (
        "[tool.pytest.ini_options]\n"
        'testpaths = ["tests"]\n'
        'pythonpath = ["tests", "scripts"]\n'
        "\n"
        "[tool.mutmut]\n"
        'source_paths = ["hqptuner"]\n'
        'pytest_add_cli_args = ["-m", "not live and not e2e", "-x", "-q"]\n'
        "\n"
        "[tool.ruff.lint.mccabe]\n"
        f"max-complexity = {limit}\n"
        "\n"
        "[tool.mypy]\n"
        "strict = true\n"
        'mypy_path = ["tests", "scripts"]\n'
    )


def xenon_command(grade: str) -> str:
    """Xenon's invocation as the repository writes it, with ``grade`` as the per-block limit."""
    return f"xenon --max-absolute {grade} --max-average A --max-modules A hqptuner"


def makefile(grade: str) -> str:
    """A Makefile whose lint recipe runs xenon at ``grade`` and whose test recipe runs offline."""
    return (
        "VENV := .venv/bin\n"
        "\n"
        "lint:\n"
        f"\t$(VENV)/{xenon_command(grade)}\n"
        "\n"
        "test:\n"
        '\t$(VENV)/pytest -m "not live and not e2e" -q\n'
    )


def precommit(grade: str) -> str:
    """A pre-commit config whose xenon hook runs at ``grade``."""
    return (
        "repos:\n"
        "  - repo: local\n"
        "    hooks:\n"
        "      - id: xenon\n"
        "        name: xenon complexity gate\n"
        f"        entry: .venv/bin/{xenon_command(grade)}\n"
        "        language: system\n"
        "        pass_filenames: false\n"
        "        types: [python]\n"
    )


def eslint_config(limit: int) -> str:
    """An eslint flat config whose complexity ceiling agrees with ``limit``."""
    return f'const RULES = {{\n  complexity: ["error", {limit}],\n}};\n\nexport default [{{ rules: RULES }}];\n'


def build_tree(root: Path, limit: int, make_grade: str, hook_grade: str) -> Path:
    """Lay out a miniature repository root at ``root`` and return it."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "pyproject.toml").write_text(pyproject(limit), encoding="utf-8")
    (root / "Makefile").write_text(makefile(make_grade), encoding="utf-8")
    (root / ".pre-commit-config.yaml").write_text(precommit(hook_grade), encoding="utf-8")
    (root / "eslint.config.js").write_text(eslint_config(limit), encoding="utf-8")
    return root


@pytest.mark.parametrize("grade", ["A", "C", "F"])
@pytest.mark.parametrize("copy", ["Makefile", "pre-commit"])
def test_a_grade_whose_ceiling_is_not_ruffs_limit_is_refused(tmp_path: Path, grade: str, copy: str) -> None:
    make_grade = grade if copy == "Makefile" else "B"
    hook_grade = grade if copy == "pre-commit" else "B"
    root = build_tree(tmp_path, LIMIT_AT_B_CEILING, make_grade, hook_grade)
    assert CHECK(root) != PASSED


def test_the_grade_whose_ceiling_is_ruffs_limit_passes_where_its_neighbor_is_refused(tmp_path: Path) -> None:
    matched = build_tree(tmp_path / "matched", LIMIT_AT_C_CEILING, "C", "C")
    mismatched = build_tree(tmp_path / "mismatched", LIMIT_AT_C_CEILING, "B", "B")
    assert CHECK(matched) < CHECK(mismatched)


def test_the_grade_whose_band_holds_ruffs_limit_is_refused_when_the_limit_is_not_its_ceiling(tmp_path: Path) -> None:
    root = build_tree(tmp_path, LIMIT_ON_NO_CEILING, "C", "C")
    assert CHECK(root) != PASSED
