"""Checks that refuse a result file an earlier run left behind.

A run that is killed or crashes leaves the previous run's result files on disk,
and a check reading them would pass on old results. Each run therefore stamps
its start: ``scripts/pytest_plugins/run_stamp.py`` is a pytest plugin loaded
with ``-p run_stamp`` that writes ``.pytest-run.json`` in the run's root
directory. ``scripts/gates/testing/check_fresh_reports.py`` offers
``check(stamp, reports) -> int``: 1 when a report is missing or older than the
run the stamp records, 0 otherwise, naming each offending report on stdout.

What the stamp holds is the plugin's own business, so every case gets its stamp
from a real run of the plugin, in-process through ``pytester`` over a throwaway
rootdir, and observes it only through the gate.
"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

pytest_plugins = ["pytester"]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/testing/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[3] / "scripts" / "gates" / "testing" / "check_fresh_reports.py"


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_fresh_reports_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECK: Callable[[Path, list[Path]], int] = _load_gate().check

#: The stamp's file name, in the root directory of the run that writes it.
STAMP = ".pytest-run.json"

#: Two of the result files the gate reads after a run.
JUNIT = ".pytest-junit.xml"
COVERAGE = ".coverage.json"

INI = """
[pytest]
asyncio_default_fixture_loop_scope = function
"""

#: A suite that passes and writes nothing.
PLAIN_SUITE = """
def test_passes():
    pass
"""

#: A suite that crashes before any test runs: its only module fails to import.
CRASHING_SUITE = """
raise RuntimeError("the run crashes while collecting")
"""


def _run(pytester: pytest.Pytester, suite: str) -> Path:
    """Runs ``suite`` with the plugin loaded; the stamp path in the run's root."""
    path = pytester.makepyfile(test_suite=suite)
    pytester.runpytest_inprocess("-p", "run_stamp", str(path))
    return pytester.path / STAMP


@pytest.fixture
def rootdir(pytester: pytest.Pytester) -> Path:
    pytester.makeini(INI)
    return pytester.path


def test_reports_the_last_run_left_fail_the_check_once_a_run_that_crashes_has_started(
    pytester: pytest.Pytester, rootdir: Path
) -> None:
    _run(pytester, PLAIN_SUITE)
    reports = [(rootdir / name) for name in (JUNIT, COVERAGE)]
    for report in reports:
        report.write_text("{}", encoding="utf-8")
    stamp = _run(pytester, CRASHING_SUITE)
    assert CHECK(stamp, reports) == 1
