"""The gate that refuses a test suite slower than the last green run.

``scripts/gates/check_suite_time.py`` reads the junit XML report pytest wrote
(``--junitxml``) and a JSON baseline file holding the last green run's wall
time in seconds, and answers with an exit code. A green run within
``ESCALATE`` seconds of the baseline passes and becomes the new baseline; one
further over needs the owner's ``accept``; one at or past ``REJECT`` over is
refused with or without it. A red report is not judged and not recorded, and a
missing baseline is seeded from the first green report.

These cases hand-build the report XML and the baseline JSON under ``tmp_path``
and call the script's checking function with those paths, the pattern of
``test_coverage_floor.py``. Observable contract is the int exit code, over one
call or a sequence of calls sharing a baseline path. Nothing here runs pytest,
and nothing here reads the gate's internals or the baseline file it writes.

The seam is ``check(report, baseline, *, accept=False) -> int``.
"""

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_suite_time.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_suite_time_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check

#: The wall time of the last green run every baseline-carrying case starts from.
BASELINE_SECONDS = 50.0


def write_report(tmp_path: Path, seconds: float, *, failures: int = 0, errors: int = 0) -> Path:
    """Write a junit report shaped the way pytest's ``--junitxml`` writes one.

    ``time`` on the ``testsuite`` element is the session's elapsed wall time,
    three decimals; ``failures`` and ``errors`` are the counts a red run carries.
    """
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<testsuites name="pytest tests">'
        f'<testsuite name="pytest" errors="{errors}" failures="{failures}" skipped="0" tests="3" '
        f'time="{seconds:.3f}" timestamp="2026-09-06T12:00:00.000000+00:00" hostname="probe">'
        '<testcase classname="tests.test_probe" name="test_one" time="0.001" />'
        "</testsuite></testsuites>"
    )
    path = tmp_path / "junit.xml"
    path.write_text(body, encoding="utf-8")
    return path


def write_baseline(tmp_path: Path, seconds: float) -> Path:
    """Write the baseline file: JSON ``{"seconds": <float>}``."""
    path = tmp_path / "suite-time.json"
    path.write_text(json.dumps({"seconds": seconds}), encoding="utf-8")
    return path


# --- 1. one green run against a 50.0 s baseline, over the escalate and reject bands


@pytest.mark.parametrize(
    ("seconds", "accept", "expected"),
    [
        (53.0, False, 0),
        (55.0, False, 0),
        (57.5, False, 1),
        (57.5, True, 0),
        (59.9, True, 0),
        (60.0, True, 1),
        (61.0, False, 1),
    ],
)
def test_a_green_run_is_judged_by_seconds_over_the_baseline_with_accept_clearing_only_the_escalate_band(
    tmp_path: Path, *, seconds: float, accept: bool, expected: int
) -> None:
    report = write_report(tmp_path, seconds)
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    assert CHECK(report, baseline, accept=accept) == expected


# --- 2. a refused run does not move the baseline --------------------------------


def test_a_refused_run_is_not_recorded_so_the_next_run_is_still_judged_against_the_old_baseline(
    tmp_path: Path,
) -> None:
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    first = CHECK(write_report(tmp_path, 57.5), baseline)
    second = CHECK(write_report(tmp_path, 62.0), baseline)
    assert [first, second] == [1, 1]


# --- 3. a red run is neither judged nor recorded --------------------------------


def test_a_red_run_fails_without_being_judged_or_recorded_so_a_green_run_after_it_is_judged_against_the_old_baseline(
    tmp_path: Path,
) -> None:
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    red = CHECK(write_report(tmp_path, 20.0, failures=1), baseline)
    green = CHECK(write_report(tmp_path, 53.0), baseline)
    assert [red, green] == [1, 0]


# --- 4. a missing baseline is seeded from the first green run and then enforced --


def test_a_missing_baseline_is_seeded_from_the_first_green_run_and_each_pass_records_the_new_baseline(
    tmp_path: Path,
) -> None:
    baseline = tmp_path / "never-written.json"
    codes = [CHECK(write_report(tmp_path, seconds), baseline) for seconds in (57.5, 62.0, 68.0)]
    assert codes == [0, 0, 1]
