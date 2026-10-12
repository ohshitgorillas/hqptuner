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

The watch also takes ``waited``, which answers the seconds the suite's main
thread has so far sat ready to run but waiting for a CPU. Each second of that
wait buys the run one more second of wall time, so the run is ended once its
wall time less its CPU-wait reaches ``seconds``. The cases for it simulate one
wall clock shared by the finish signal and the CPU-wait reading: a wait that
runs out has spent its whole timeout, and the CPU-wait is read from a table of
what had built up by each wall time.
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


#: How many waits a simulated run answers before it reports itself finished, so a
#: watch that never ends the run returns instead of spinning.
WAIT_CAP = 1000


class _LoadedRun:
    """A run on a busy host, as a finish signal and a CPU-wait reading on one simulated wall clock.

    ``wait(timeout)`` answers at once. A run still going spends the whole
    ``timeout``; one that finishes inside it stops the clock at ``finishes_at``.
    ``waited()`` answers from ``cpu_wait``, pairs of a wall time and the CPU-wait
    built up by then.
    """

    def __init__(self, cpu_wait: list[tuple[float, float]], *, finishes_at: float | None = None) -> None:
        self.cpu_wait = cpu_wait
        self.finishes_at = finishes_at
        self.wall = 0.0
        self.waits = 0

    def wait(self, timeout: float) -> bool:
        self.waits += 1
        if self.waits > WAIT_CAP:
            return True
        if self.finishes_at is not None and self.wall + timeout >= self.finishes_at:
            self.wall = self.finishes_at
            return True
        self.wall += timeout
        return False

    def waited(self) -> float:
        return max((built for at, built in self.cpu_wait if at <= self.wall), default=0.0)


def _ended_at(tmp_path: Path, seconds: float, run: _LoadedRun) -> list[float]:
    """The simulated wall time at each point the watch ended the run."""
    ended: list[float] = []
    with (tmp_path / "dump.txt").open("w") as dump_to:
        suite_deadline.watch(
            seconds, run, dump_to=dump_to, terminate=lambda _code: ended.append(run.wall), waited=run.waited
        )
    return ended


@pytest.mark.parametrize(
    ("seconds", "cpu_wait", "expected"),
    [
        (60.0, [(60.0, 4.5)], 64.5),
        (130.0, [(130.0, 12.0), (142.0, 14.5)], 144.5),
    ],
    ids=["wait built up before the deadline", "more wait built up in the time it bought"],
)
def test_a_run_that_waited_for_a_cpu_is_ended_that_much_wall_time_past_its_deadline(
    tmp_path: Path, *, seconds: float, cpu_wait: list[tuple[float, float]], expected: float
) -> None:
    assert _ended_at(tmp_path, seconds, _LoadedRun(cpu_wait)) == [expected]
