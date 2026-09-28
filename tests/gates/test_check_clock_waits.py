"""The gate that refuses a test whose real-clock timeout ran out.

``scripts/gates/check_clock_waits.py`` reads the report ``scripts/clock_probe.py``
writes: the session's exit status, and per test the seconds of each kind of
real-clock timeout that expired while it ran. Any test with a reading above
zero is refused. A red session is not judged, and a missing report fails.

These cases hand-build the report under ``tmp_path``. Observable contract is
the list ``waiting`` returns and the int exit code ``check`` returns. Nothing
here runs pytest.
"""

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_clock_waits.py"


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_clock_waits_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def write_report(tmp_path: Path, tests: dict[str, dict[str, float]], *, exitstatus: int = 0) -> Path:
    """Write a report shaped the way the probe writes one."""
    path = tmp_path / "clock-probe.json"
    path.write_text(json.dumps({"exitstatus": exitstatus, "tests": tests}))
    return path


def test_only_the_tests_with_an_expired_timeout_are_waiting() -> None:
    tests = {"t::b": {"loop timer": 2.0}, "t::a": {"Condition.wait": 1.0, "time.sleep": 3.0}, "t::c": {}}
    assert GATE.waiting(tests) == ["t::a", "t::b"]


@pytest.mark.parametrize(("kinds", "expected"), [({"Thread.join": 2.0}, 1), ({}, 0)], ids=["expired", "none"])
def test_a_green_session_is_refused_only_when_a_timeout_ran_out(
    tmp_path: Path, kinds: dict[str, float], expected: int
) -> None:
    assert GATE.check(write_report(tmp_path, {"t::a": kinds, "t::b": {}})) == expected


def test_a_red_session_is_not_judged(tmp_path: Path) -> None:
    assert GATE.check(write_report(tmp_path, {"t::a": {}}, exitstatus=1)) == 1


def test_a_missing_report_fails(tmp_path: Path) -> None:
    assert GATE.check(tmp_path / "absent.json") == 1
