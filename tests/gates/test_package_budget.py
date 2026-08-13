"""The gate that holds a package directory to a total line budget.

``scripts/gates/check_package_budget.py`` takes no filenames. It walks the repo
and asks one question of every entry in its module-level ``BUDGET`` mapping:
do the ``.py`` files sitting directly in this directory add up to no more than
the number written down? A file-length cap alone is satisfied by splitting one
long module into four short ones that still know everything about each other;
the budget is what makes that split cost something. The mapping is opt-in — a
package nobody has budgeted is not measured — and an entry naming a directory
that is not in the tree is drift, the same way a stale exemption is in the
other gates.

Each case lays out a miniature repo under ``tmp_path`` with files of known
length and points the script's checking function at it, injecting its own
budget mapping. Observable contract is the pair the script offers a caller: the
int exit code, and what lands on stdout. Nothing here reads the gate's
internals.

The seam is ``check(root, budget) -> int``.
"""

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_package_budget.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_package_budget_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check


def build_package(root: Path, package: str, files: dict[str, int]) -> Path:
    """Lay out ``package`` under ``root`` with each named file at its given line count."""
    directory = root / package
    directory.mkdir(parents=True, exist_ok=True)
    for name, lines in files.items():
        (directory / name).write_text("".join(f"x = {n}\n" for n in range(lines)), encoding="utf-8")
    return directory


def line_naming(out: str, needle: str) -> str:
    """The first stdout line that names ``needle``, or ``""`` when no line does."""
    for line in out.splitlines():
        if needle in line:
            return line
    return ""


def shipped_budget() -> dict[str, int]:
    """The module's own ``BUDGET`` mapping, skipping the case when it has nothing in it."""
    shipped = dict(GATE.BUDGET)
    if not shipped:
        pytest.skip("the shipped BUDGET mapping is empty, so no entry can discriminate on it")
    return shipped


def tree_breaking_one_shipped_budget(root: Path) -> None:
    """Lay out every budgeted directory under ``root``, with the first one one line over."""
    shipped = shipped_budget()
    over = min(shipped)
    for package in shipped:
        (root / package).mkdir(parents=True, exist_ok=True)
    build_package(root, over, {"sprawl.py": shipped[over] + 1})


def install_gate(root: Path) -> None:
    """Copy the gate script into ``root`` so a subprocess run of it sees ``root`` as the repo."""
    gate_dir = root / "scripts" / "gates"
    gate_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(GATE_PATH, gate_dir / GATE_PATH.name)


def run_gate(root: Path) -> int:
    """Run the gate script the way the Makefile does and return its exit status."""
    # S603: the argv is this module's own literals.
    completed = subprocess.run(  # noqa: S603
        [sys.executable, str(Path("scripts") / "gates" / GATE_PATH.name)],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.returncode


def test_a_package_under_its_budget_passes(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150})
    assert CHECK(tmp_path, {"hqptuner/core": 400}) == 0


def test_a_package_exactly_at_its_budget_passes(tmp_path: Path) -> None:
    """The comparison is ``<=``: spending the budget is staying inside it."""
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150})
    assert CHECK(tmp_path, {"hqptuner/core": 250}) == 0


def test_a_package_over_its_budget_fails(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150, "c.py": 60})
    assert CHECK(tmp_path, {"hqptuner/core": 250}) == 1


def test_a_package_over_its_budget_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150, "c.py": 60})
    CHECK(tmp_path, {"hqptuner/core": 250})
    assert "hqptuner/core" in capsys.readouterr().out


def test_a_package_over_its_budget_is_told_its_measured_total(tmp_path: Path, capsys: Any) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150, "c.py": 60})
    CHECK(tmp_path, {"hqptuner/core": 250})
    assert "310" in line_naming(capsys.readouterr().out, "hqptuner/core")


def test_a_package_over_its_budget_is_told_the_budget_it_broke(tmp_path: Path, capsys: Any) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 150, "c.py": 60})
    CHECK(tmp_path, {"hqptuner/core": 250})
    assert "250" in line_naming(capsys.readouterr().out, "hqptuner/core")


def test_a_budget_entry_naming_no_directory_in_the_tree_fails_as_stale(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    assert CHECK(tmp_path, {"hqptuner/renamed_away": 400}) == 1


def test_a_budget_entry_naming_no_directory_in_the_tree_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    CHECK(tmp_path, {"hqptuner/renamed_away": 400})
    assert "hqptuner/renamed_away" in capsys.readouterr().out


def test_a_package_carrying_no_budget_entry_passes(tmp_path: Path) -> None:
    """The mapping is opt-in, not an inventory: an unbudgeted package is not measured."""
    build_package(tmp_path, "hqptuner/sprawl", {"a.py": 4000})
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    assert CHECK(tmp_path, {"hqptuner/core": 400}) == 0


def test_an_unbudgeted_package_is_not_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    build_package(tmp_path, "hqptuner/sprawl", {"a.py": 4000})
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    CHECK(tmp_path, {"hqptuner/core": 400})
    assert "hqptuner/sprawl" not in capsys.readouterr().out


def test_lines_in_a_subpackage_do_not_count_against_the_parent(tmp_path: Path) -> None:
    """The budget is the directory's own modules; a subpackage carries its own."""
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    build_package(tmp_path, "hqptuner/core/deep", {"b.py": 900})
    assert CHECK(tmp_path, {"hqptuner/core": 250}) == 0


def test_a_non_python_file_does_not_count_against_the_budget(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "enums.json": 900})
    assert CHECK(tmp_path, {"hqptuner/core": 250}) == 0


def test_one_package_over_budget_fails_a_tree_whose_others_pass(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100})
    build_package(tmp_path, "hqptuner/lanes", {"a.py": 500})
    build_package(tmp_path, "hqptuner/conf", {"a.py": 80})
    assert CHECK(tmp_path, {"hqptuner/core": 250, "hqptuner/lanes": 250, "hqptuner/conf": 250}) == 1


@pytest.mark.parametrize("expected", ["hqptuner/core", "hqptuner/lanes"])
def test_every_package_over_budget_is_reported_not_only_the_first(tmp_path: Path, capsys: Any, expected: str) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 400})
    build_package(tmp_path, "hqptuner/lanes", {"a.py": 500})
    CHECK(tmp_path, {"hqptuner/core": 250, "hqptuner/lanes": 250})
    assert expected in capsys.readouterr().out


def test_a_budgeted_directory_holding_no_python_files_passes(tmp_path: Path) -> None:
    """A directory that is in the tree is present, and an empty one totals zero rather than being stale."""
    (tmp_path / "hqptuner/core").mkdir(parents=True)
    assert CHECK(tmp_path, {"hqptuner/core": 250}) == 0


def test_a_budgeted_directory_holding_no_python_files_is_not_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    (tmp_path / "hqptuner/core").mkdir(parents=True)
    CHECK(tmp_path, {"hqptuner/core": 250})
    assert "hqptuner/core" not in capsys.readouterr().out


def test_omitting_the_budget_mapping_falls_back_to_the_shipped_one(tmp_path: Path) -> None:
    """A caller who passes no mapping gets the module's own table, so its numbers are the ones enforced."""
    tree_breaking_one_shipped_budget(tmp_path)
    assert (CHECK(tmp_path), CHECK(tmp_path, {})) == (1, 0)


def test_running_the_script_over_a_tree_past_a_budget_exits_nonzero(tmp_path: Path) -> None:
    """The Makefile runs the script, so the exit status has to carry the same answer as ``check``."""
    install_gate(tmp_path)
    tree_breaking_one_shipped_budget(tmp_path)
    assert run_gate(tmp_path) == 1


def test_running_the_script_over_a_tree_inside_every_budget_exits_zero(tmp_path: Path) -> None:
    """The other half of the exit status: a clean run says so rather than failing on its own feet."""
    install_gate(tmp_path)
    for package in shipped_budget():
        (tmp_path / package).mkdir(parents=True, exist_ok=True)
    assert run_gate(tmp_path) == 0


def test_a_tree_inside_every_budget_passes(tmp_path: Path) -> None:
    build_package(tmp_path, "hqptuner/core", {"a.py": 100, "b.py": 90})
    build_package(tmp_path, "hqptuner/lanes", {"a.py": 40})
    assert CHECK(tmp_path, {"hqptuner/core": 250, "hqptuner/lanes": 250}) == 0
