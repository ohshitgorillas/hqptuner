"""When the suite deadline aborts an offline run, and what the abort leaves behind.

``scripts/suite_deadline.py`` is a pytest plugin loaded with ``-p suite_deadline``.
It holds a run to the bar ``scripts/gates/testing/check_suite_time.py`` rejects
at, ten seconds past the last green run's wall time, read from the baseline that
gate keeps. Past it, the run is terminated with a nonzero exit code after the
stack of every thread is dumped.

Two seams carry the contract:

- ``deadline(baseline) -> float | None``: the seconds after session start at
  which the run is aborted, or ``None`` when no baseline is recorded. These
  cases let the gate itself write the baseline, through its ``check(report,
  baseline)`` seam, from a hand-built junit report.
- ``watch(seconds, finished, *, dump_to, terminate)``: waits on ``finished``
  (the ``threading.Event`` protocol, ``wait(timeout) -> bool``) for ``seconds``;
  a run still going when the wait runs out has every thread's stack written to
  the file ``dump_to`` and is ended through ``terminate(code)``. These cases
  hand in a finish signal that answers at once, so nothing waits on a real
  clock, and a ``terminate`` that records the code instead of ending the process.
"""

import importlib.util
import threading
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
import suite_deadline
from narrow import FixtureError

GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "testing" / "check_suite_time.py"


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_suite_time_for_deadline", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RECORD_GREEN_RUN: Callable[[Path, Path], int] = _load_gate().check


def _recorded_baseline(tmp_path: Path, seconds: float) -> Path:
    """A baseline the suite-time gate wrote from one green run of ``seconds`` wall time."""
    report = tmp_path / "junit.xml"
    report.write_text(
        '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">'
        f'<testsuite name="pytest" errors="0" failures="0" skipped="0" tests="1" time="{seconds:.3f}">'
        '<testcase classname="tests.test_probe" name="test_one" time="0.001" />'
        "</testsuite></testsuites>",
        encoding="utf-8",
    )
    baseline = tmp_path / "suite-time.json"
    if RECORD_GREEN_RUN(report, baseline) != 0:
        raise FixtureError(reason=f"the suite-time gate refused a first green run of {seconds} s")
    return baseline


@pytest.mark.parametrize(("recorded", "expected"), [(50.0, 60.0), (120.0, 130.0)])
def test_the_deadline_is_ten_seconds_past_the_wall_time_the_suite_time_gate_recorded(
    tmp_path: Path, *, recorded: float, expected: float
) -> None:
    assert suite_deadline.deadline(_recorded_baseline(tmp_path, recorded)) == expected


def test_there_is_no_deadline_until_the_suite_time_gate_records_a_baseline(tmp_path: Path) -> None:
    before = suite_deadline.deadline(tmp_path / "suite-time.json")
    after = suite_deadline.deadline(_recorded_baseline(tmp_path, 75.0))
    assert [before, after] == [None, 85.0]


class _Finished:
    """A run's finish signal that answers at once: set in time, or still clear at the deadline."""

    def __init__(self, *, in_time: bool) -> None:
        self.in_time = in_time
        self.asked: list[float] = []

    def wait(self, timeout: float) -> bool:
        self.asked.append(timeout)
        return self.in_time


def _terminations(tmp_path: Path, *, in_time: bool) -> list[bool]:
    """For each time the watch ended the run, whether it ended it with a nonzero code."""
    codes: list[int] = []
    with (tmp_path / f"dump-{in_time}.txt").open("w") as dump_to:
        suite_deadline.watch(60.0, _Finished(in_time=in_time), dump_to=dump_to, terminate=codes.append)
    return [code != 0 for code in codes]


def test_only_a_run_still_going_at_the_deadline_is_terminated_with_a_nonzero_code(tmp_path: Path) -> None:
    outcomes = [_terminations(tmp_path, in_time=True), _terminations(tmp_path, in_time=False)]
    assert outcomes == [[], [True]]


@pytest.mark.parametrize("seconds", [60.0, 130.0])
def test_the_watch_gives_the_run_exactly_its_deadline_to_finish(tmp_path: Path, *, seconds: float) -> None:
    finished = _Finished(in_time=True)
    with (tmp_path / "dump.txt").open("w") as dump_to:
        suite_deadline.watch(seconds, finished, dump_to=dump_to, terminate=lambda _code: None)
    assert finished.asked == [seconds]


def parked_in_a_hung_test(started: threading.Event, release: threading.Event) -> None:
    started.set()
    release.wait()


def _dump_with_a_parked_thread(tmp_path: Path) -> str:
    """What the watch dumped at the deadline while another thread sat in ``parked_in_a_hung_test``."""
    started, release = threading.Event(), threading.Event()
    parked = threading.Thread(target=parked_in_a_hung_test, args=(started, release))
    parked.start()
    started.wait()
    path = tmp_path / "dump.txt"
    try:
        with path.open("w") as dump_to:
            suite_deadline.watch(60.0, _Finished(in_time=False), dump_to=dump_to, terminate=lambda _code: None)
    finally:
        release.set()
        parked.join()
    return path.read_text(encoding="utf-8")


def test_a_run_terminated_at_the_deadline_dumps_the_stack_of_every_thread(tmp_path: Path) -> None:
    assert parked_in_a_hung_test.__name__ in _dump_with_a_parked_thread(tmp_path)
