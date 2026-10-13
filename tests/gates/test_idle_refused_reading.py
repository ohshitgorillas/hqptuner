"""A reading the idle gate refused is not recorded.

``scripts/gates/check_idle.py`` judges the report the idle probe writes, JSON
``{"exitstatus": <int>, "tests": {<node id>: <idle seconds>}}``, against a
record of each test's previous reading, and fails a test whose reading rises
more than 40 ms over its previous one or, with no previous one, exceeds 40 ms.
Only a passing reading moves the record: a refused test keeps its previous
reading, so a real regression fails on every run until it is fixed rather than
failing once and becoming the record.

These cases hand-build each report under ``tmp_path`` and call the gate's
``check(report, record) -> int`` with one record path shared across the calls,
the pattern of ``test_suite_time.py``. The record starts absent. Observable
contract is the exit code: the last call's code is the code the gate gave the
same reading when it first refused it. A setup call whose verdict is not the
one the rule gives is a broken fixture. Nothing here reads the record file the
gate writes.
"""

import importlib.util
import json
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

from narrow import FixtureError

#: The gate under test, found relative to this file: it lives in ``scripts/gates/``,
#: outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_idle.py"


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_idle_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECK: Callable[[Path, Path], int] = _load_gate().check

#: The test whose readings each case feeds the gate.
NODE = "tests/test_probe.py::test_one"

#: A reading well under the 40 ms ceiling: passes with or without a previous one.
QUIET = 0.010

#: 90 ms over ``QUIET`` and 60 ms over the ceiling: refused against ``QUIET``
#: and refused with no previous reading.
REGRESSED = 0.100

#: The exit status pytest gives a green session.
GREEN = 0


def run_gate(tmp_path: Path, record: Path, readings: dict[str, float]) -> int:
    """Write one green idle-probe report holding ``readings`` and judge it against ``record``."""
    report = tmp_path / ".idle-probe.json"
    report.write_text(json.dumps({"exitstatus": GREEN, "tests": readings}), encoding="utf-8")
    return CHECK(report, record)


def passed(tmp_path: Path, record: Path, readings: dict[str, float]) -> None:
    """Judge ``readings``, which the rule passes, against ``record``."""
    code = run_gate(tmp_path, record, readings)
    if code != 0:
        raise FixtureError(reason=f"the gate refused setup readings {readings} with {code}")


def refused(tmp_path: Path, record: Path, readings: dict[str, float]) -> int:
    """Judge ``readings``, which the rule refuses, against ``record``, and return the refusal's code."""
    code = run_gate(tmp_path, record, readings)
    if code == 0:
        raise FixtureError(reason=f"the gate passed setup readings {readings}")
    return code


def test_a_regression_the_gate_refused_is_refused_again_on_the_next_run(tmp_path: Path) -> None:
    record = tmp_path / "idle-record.json"
    passed(tmp_path, record, {NODE: QUIET})
    first = refused(tmp_path, record, {NODE: REGRESSED})
    assert run_gate(tmp_path, record, {NODE: REGRESSED}) == first


def test_a_first_reading_over_the_ceiling_is_refused_again_on_the_next_run(tmp_path: Path) -> None:
    record = tmp_path / "idle-record.json"
    first = refused(tmp_path, record, {NODE: REGRESSED})
    assert run_gate(tmp_path, record, {NODE: REGRESSED}) == first
