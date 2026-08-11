"""The gate that checks every gate is itself wired up (``docs/testing.md``).

``scripts/gates/check_gates_wired.py`` walks ``scripts/gates/`` and asks two
questions of every gate script it finds: is this filename named on a live
(non-comment) line of the ``Makefile``, and is it named on a live line of
``.pre-commit-config.yaml`` — or excused from the latter by an entry in the
module's ``PRECOMMIT_EXEMPT`` mapping. A gate nobody runs is a gate that has
silently stopped being a gate, and a stale exemption key is the same drift
wearing a permission slip.

These cases build a throwaway tree — ``scripts/gates/<name>.py``, a
``Makefile``, a ``.pre-commit-config.yaml`` — and point the script's checking
function at it, injecting their own exemption mapping. Observable contract is
the pair the script offers a caller: the int exit code, and what lands on
stdout. Nothing here reads the gate's internals.

The seam is ``check(root, exempt=None) -> int``; passing an exemption mapping
positionally is how a case gets its own excuses in front of the checker, and
``None`` falls back to the module's shipped ``PRECOMMIT_EXEMPT``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_gates_wired.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_gates_wired_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check


def build_tree(
    tmp_path: Path,
    gates: list[str],
    makefile: str,
    precommit: str,
) -> Path:
    """Lay out a miniature repo root: gate scripts, a Makefile, a pre-commit config."""
    gate_dir = tmp_path / "scripts" / "gates"
    gate_dir.mkdir(parents=True)
    for gate in gates:
        (gate_dir / gate).write_text("import sys\n\nsys.exit(0)\n", encoding="utf-8")
    (tmp_path / "Makefile").write_text(makefile, encoding="utf-8")
    (tmp_path / ".pre-commit-config.yaml").write_text(precommit, encoding="utf-8")
    return tmp_path


def make_line(gate: str) -> str:
    """A live Makefile recipe line running one gate, as the real Makefile writes it."""
    return f"\t$(VENV)/python scripts/gates/{gate}\n"


def hook_block(gate: str) -> str:
    """A live pre-commit hook entry running one gate, as the real config writes it."""
    return (
        f"      - id: {gate.replace('_', '-').removesuffix('.py')}\n"
        f"        name: {gate}\n"
        f"        entry: .venv/bin/python scripts/gates/{gate}\n"
        "        language: system\n"
    )


def wired_tree(tmp_path: Path, gates: list[str]) -> Path:
    """A tree where every gate is named live in both the Makefile and pre-commit."""
    return build_tree(
        tmp_path,
        gates,
        "check:\n" + "".join(make_line(g) for g in gates),
        "repos:\n  - repo: local\n    hooks:\n" + "".join(hook_block(g) for g in gates),
    )


def test_a_gate_absent_from_the_makefile_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = build_tree(
        tmp_path,
        ["check_orphan.py"],
        "check:\n\techo nothing\n",
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_orphan.py"),
    )
    CHECK(root, {})
    assert "check_orphan.py" in capsys.readouterr().out


def test_a_gate_absent_from_the_makefile_fails_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_orphan.py"],
        "check:\n\techo nothing\n",
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_orphan.py"),
    )
    assert CHECK(root, {}) == 1


def test_a_gate_only_on_a_commented_makefile_line_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = build_tree(
        tmp_path,
        ["check_shelved.py"],
        "check:\n#\t$(VENV)/python scripts/gates/check_shelved.py\n",
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_shelved.py"),
    )
    CHECK(root, {})
    assert "check_shelved.py" in capsys.readouterr().out


def test_a_gate_only_on_a_commented_makefile_line_fails_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_shelved.py"],
        "check:\n#\t$(VENV)/python scripts/gates/check_shelved.py\n",
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_shelved.py"),
    )
    assert CHECK(root, {}) == 1


def test_a_gate_absent_from_pre_commit_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = build_tree(
        tmp_path,
        ["check_unhooked.py"],
        "check:\n" + make_line("check_unhooked.py"),
        "repos:\n  - repo: local\n    hooks: []\n",
    )
    CHECK(root, {})
    assert "check_unhooked.py" in capsys.readouterr().out


def test_a_gate_absent_from_pre_commit_fails_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_unhooked.py"],
        "check:\n" + make_line("check_unhooked.py"),
        "repos:\n  - repo: local\n    hooks: []\n",
    )
    assert CHECK(root, {}) == 1


def test_a_gate_only_on_a_commented_pre_commit_line_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = build_tree(
        tmp_path,
        ["check_shelved.py"],
        "check:\n" + make_line("check_shelved.py"),
        "repos:\n  - repo: local\n    hooks: []\n      # entry: .venv/bin/python scripts/gates/check_shelved.py\n",
    )
    CHECK(root, {})
    assert "check_shelved.py" in capsys.readouterr().out


def test_a_gate_only_on_a_commented_pre_commit_line_fails_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_shelved.py"],
        "check:\n" + make_line("check_shelved.py"),
        "repos:\n  - repo: local\n    hooks: []\n      # entry: .venv/bin/python scripts/gates/check_shelved.py\n",
    )
    assert CHECK(root, {}) == 1


def test_an_exempt_gate_absent_from_pre_commit_is_not_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = build_tree(
        tmp_path,
        ["check_slow.py"],
        "check:\n" + make_line("check_slow.py"),
        "repos:\n  - repo: local\n    hooks: []\n",
    )
    CHECK(root, {"check_slow.py": "too slow for a commit hook"})
    assert "check_slow.py" not in capsys.readouterr().out


def test_an_exempt_gate_absent_from_pre_commit_passes_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_slow.py"],
        "check:\n" + make_line("check_slow.py"),
        "repos:\n  - repo: local\n    hooks: []\n",
    )
    assert CHECK(root, {"check_slow.py": "too slow for a commit hook"}) == 0


def test_an_exemption_naming_no_gate_file_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    root = wired_tree(tmp_path, ["check_present.py"])
    CHECK(root, {"check_deleted_last_year.py": "excused for a reason nobody remembers"})
    assert "check_deleted_last_year.py" in capsys.readouterr().out


def test_an_exemption_naming_no_gate_file_fails_the_gate(tmp_path: Path) -> None:
    root = wired_tree(tmp_path, ["check_present.py"])
    assert CHECK(root, {"check_deleted_last_year.py": "excused for a reason nobody remembers"}) == 1


@pytest.mark.parametrize("expected", ["check_unwired.py", "check_unhooked.py"])
def test_both_the_makefile_and_pre_commit_failures_are_reported_together(
    tmp_path: Path, capsys: Any, expected: str
) -> None:
    root = build_tree(
        tmp_path,
        ["check_unwired.py", "check_unhooked.py"],
        "check:\n" + make_line("check_unhooked.py"),
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_unwired.py"),
    )
    CHECK(root, {})
    assert expected in capsys.readouterr().out


def test_a_tree_failing_both_checks_fails_the_gate(tmp_path: Path) -> None:
    root = build_tree(
        tmp_path,
        ["check_unwired.py", "check_unhooked.py"],
        "check:\n" + make_line("check_unhooked.py"),
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_unwired.py"),
    )
    assert CHECK(root, {}) == 1


def test_a_fully_wired_tree_passes_the_gate(tmp_path: Path) -> None:
    root = wired_tree(tmp_path, ["check_one.py", "check_two.py"])
    assert CHECK(root, {}) == 0


def test_omitting_the_exemption_mapping_falls_back_to_the_shipped_one(tmp_path: Path) -> None:
    """A caller who passes no mapping gets the module's own, not a blanket pardon."""
    root = build_tree(
        tmp_path,
        ["check_unhooked.py"],
        "check:\n" + make_line("check_unhooked.py"),
        "repos:\n  - repo: local\n    hooks: []\n",
    )
    assert CHECK(root) == 1


def test_an_exemption_does_not_excuse_a_gate_missing_from_the_makefile(tmp_path: Path) -> None:
    """The excuse is scoped to the pre-commit check; the Makefile check ignores it."""
    root = build_tree(
        tmp_path,
        ["check_slow.py"],
        "check:\n\techo nothing\n",
        "repos:\n  - repo: local\n    hooks:\n" + hook_block("check_slow.py"),
    )
    assert CHECK(root, {"check_slow.py": "too slow for a commit hook"}) == 1
