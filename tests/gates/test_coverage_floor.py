"""The gate that holds every individual source file to a coverage floor.

``scripts/gates/check_coverage_floor.py`` reads a ``coverage.py`` JSON report —
the artefact ``pytest --cov-report=json:<path>`` writes — and asks one question
of every entry in its top-level ``files`` map: does this file's
``summary.percent_covered`` reach the floor? A file that does not is named on
stdout unless an entry in the module's exemption mapping excuses it, and an
exemption naming a file the report does not contain is drift, the same way a
stale entry is in the gates-wired gate.

The two ways a coverage gate can pass vacuously are treated as failures in
their own right: a report that is not there at all (the suite died before
writing one, and the gate runs afterwards in a pre-commit config with no
``fail_fast``), and a report whose ``files`` map is empty.

These cases hand-build report JSON under ``tmp_path`` and point the script's
checking function at it, injecting their own exemption mapping. Observable
contract is the pair the script offers a caller: the int exit code, and what
lands on stdout. Nothing here reads the gate's internals, and nothing here runs
coverage.

The seam is ``check(report, floor, exempt=None) -> int``; ``None`` for the
mapping falls back to the module's own shipped exemptions.
"""

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_coverage_floor.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_coverage_floor_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check


def write_report(tmp_path: Path, percentages: dict[str, float]) -> Path:
    """Write a coverage.py-shaped JSON report naming each file at its percentage."""
    report = {
        "meta": {"format": 3, "version": "7.6.1"},
        "files": {
            path: {"summary": {"percent_covered": percent, "num_statements": 100}}
            for path, percent in percentages.items()
        },
        "totals": {"percent_covered": 100.0},
    }
    path = tmp_path / "coverage.json"
    path.write_text(json.dumps(report), encoding="utf-8")
    return path


def test_a_file_below_the_floor_fails_the_gate(tmp_path: Path) -> None:
    report = write_report(tmp_path, {"hqptuner/thin.py": 71.5})
    assert CHECK(report, 90, {}) == 1


@pytest.mark.parametrize("expected", ["hqptuner/thin.py", "71.5", "90"])
def test_a_file_below_the_floor_is_named_with_its_percentage_and_the_floor(
    tmp_path: Path, capsys: Any, expected: str
) -> None:
    report = write_report(tmp_path, {"hqptuner/thin.py": 71.5})
    CHECK(report, 90, {})
    assert expected in capsys.readouterr().out


def test_every_file_above_the_floor_passes_the_gate(tmp_path: Path) -> None:
    report = write_report(tmp_path, {"hqptuner/one.py": 97.0, "hqptuner/two.py": 100.0})
    assert CHECK(report, 90, {}) == 0


def test_a_file_exactly_at_the_floor_passes_the_gate(tmp_path: Path) -> None:
    """The comparison is ``>=``: hitting the floor is reaching it, not missing it."""
    report = write_report(tmp_path, {"hqptuner/borderline.py": 90.0})
    assert CHECK(report, 90, {}) == 0


def test_an_exempt_file_below_the_floor_passes_the_gate(tmp_path: Path) -> None:
    report = write_report(tmp_path, {"hqptuner/legacy.py": 12.0})
    assert CHECK(report, 90, {"hqptuner/legacy.py": "vendored, covered by the JS suite"}) == 0


def test_an_exempt_file_below_the_floor_is_not_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    """An exemption is silent — it excuses the file rather than warning about it."""
    report = write_report(tmp_path, {"hqptuner/legacy.py": 12.0})
    CHECK(report, 90, {"hqptuner/legacy.py": "vendored, covered by the JS suite"})
    assert "hqptuner/legacy.py" not in capsys.readouterr().out


def test_an_exemption_naming_no_file_in_the_report_fails_the_gate(tmp_path: Path) -> None:
    report = write_report(tmp_path, {"hqptuner/present.py": 99.0})
    assert CHECK(report, 90, {"hqptuner/deleted_last_year.py": "excused for a forgotten reason"}) == 1


def test_an_exemption_naming_no_file_in_the_report_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    report = write_report(tmp_path, {"hqptuner/present.py": 99.0})
    CHECK(report, 90, {"hqptuner/deleted_last_year.py": "excused for a forgotten reason"})
    assert "hqptuner/deleted_last_year.py" in capsys.readouterr().out


def test_a_missing_report_fails_the_gate(tmp_path: Path) -> None:
    """A suite that died writes no report; passing vacuously there is worse than no gate."""
    assert CHECK(tmp_path / "never-written.json", 90, {}) == 1


def test_a_missing_report_is_named_on_stdout(tmp_path: Path, capsys: Any) -> None:
    missing = tmp_path / "never-written.json"
    CHECK(missing, 90, {})
    assert str(missing) in capsys.readouterr().out


def test_a_report_measuring_no_files_fails_the_gate(tmp_path: Path) -> None:
    """An empty measurement is not a pass."""
    assert CHECK(write_report(tmp_path, {}), 90, {}) == 1


def test_a_report_measuring_no_files_says_so_on_stdout(tmp_path: Path, capsys: Any) -> None:
    CHECK(write_report(tmp_path, {}), 90, {})
    assert "files" in capsys.readouterr().out.lower()


@pytest.mark.parametrize("expected", ["hqptuner/first.py", "hqptuner/second.py", "hqptuner/third.py"])
def test_every_file_below_the_floor_is_reported_not_only_the_first(tmp_path: Path, capsys: Any, expected: str) -> None:
    report = write_report(
        tmp_path,
        {
            "hqptuner/first.py": 10.0,
            "hqptuner/second.py": 20.0,
            "hqptuner/third.py": 30.0,
            "hqptuner/fine.py": 99.0,
        },
    )
    CHECK(report, 90, {})
    assert expected in capsys.readouterr().out


def test_omitting_the_exemption_mapping_falls_back_to_the_shipped_one(tmp_path: Path) -> None:
    """A caller who passes no mapping gets the module's own, not a blanket pardon."""
    report = write_report(tmp_path, {"tests/nowhere/definitely_not_exempt.py": 3.0})
    assert CHECK(report, 90) == 1
