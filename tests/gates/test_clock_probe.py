"""What the clock probe records for each wait it wraps.

``scripts/clock_probe.py`` wraps the calls that wait on a real clock. Each
wrapper is built from the original call and a ``Recorder``, and records the
timeout the caller asked for when that timeout runs out, never when the wait
is satisfied first. These cases hand each wrapper a fake original that returns
at once as expired or as satisfied, so nothing here waits on a real clock.
Observable contract is ``Recorder.tests``: node id to seconds per kind.
"""

import importlib.util
import subprocess
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest

#: The plugin under test, found relative to this file: it lives in ``scripts/``,
#: outside any package, and loads into pytest by ``-p`` rather than by import.
PROBE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "clock_probe.py"

NODE = "tests/x.py::test_x"

#: The timeout every case asks for, in seconds.
ASKED = 2.0

Recorded = dict[str, dict[str, float]]


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


def _load_probe_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("clock_probe_under_test", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {PROBE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = _load_probe_module()


def _recorded(wait: Callable[[object], None], *, node: str | None = NODE) -> Recorded:
    """Run ``wait`` against a fresh recorder with ``node`` running; what it recorded."""
    recorder = PROBE.Recorder()
    recorder.current = node
    wait(recorder)
    return cast("Recorded", recorder.tests)


class _Loop:
    """A loop whose clock reads zero, so a timer's deadline is its delay."""

    @staticmethod
    def time() -> float:
        return 0.0


def _timer(recorder: object, *, fires: bool) -> None:
    callbacks: list[Callable[[], object]] = []

    def call_at(_loop: object, _when: float, callback: Callable[..., object], *args: object, **_kw: object) -> None:
        callbacks.append(lambda: callback(*args))

    PROBE.timed_call_at(call_at, recorder)(_Loop(), ASKED, lambda: None)
    if fires:
        callbacks[0]()


@pytest.mark.parametrize(
    ("fires", "expected"), [(True, {NODE: {"loop timer": ASKED}}), (False, {})], ids=["fired", "cancelled"]
)
def test_a_loop_timer_counts_its_delay_only_when_it_fires(*, fires: bool, expected: Recorded) -> None:
    assert _recorded(lambda recorder: _timer(recorder, fires=fires)) == expected


@pytest.mark.parametrize(
    ("seconds", "expected"), [(ASKED, {NODE: {"time.sleep": ASKED}}), (0, {})], ids=["wait", "yield"]
)
def test_a_sleep_counts_what_it_asked_for_and_a_zero_sleep_nothing(*, seconds: float, expected: Recorded) -> None:
    assert _recorded(lambda recorder: PROBE.timed_sleep(lambda _s: None, recorder)(seconds)) == expected


@pytest.mark.parametrize(
    ("satisfied", "expected"), [(False, {NODE: {"Condition.wait": ASKED}}), (True, {})], ids=["expired", "satisfied"]
)
def test_a_condition_wait_counts_its_timeout_only_when_it_expires(*, satisfied: bool, expected: Recorded) -> None:
    def wait(recorder: object) -> None:
        PROBE.timed_condition_wait(lambda _c, _t: satisfied, recorder)(object(), ASKED)

    assert _recorded(wait) == expected


class _Thread:
    def __init__(self, *, alive: bool) -> None:
        self.alive = alive

    def is_alive(self) -> bool:
        return self.alive


@pytest.mark.parametrize(
    ("alive", "expected"), [(True, {NODE: {"Thread.join": ASKED}}), (False, {})], ids=["expired", "joined"]
)
def test_a_thread_join_counts_its_timeout_only_when_the_thread_outlives_it(*, alive: bool, expected: Recorded) -> None:
    def join(recorder: object) -> None:
        PROBE.timed_join(lambda _thread, _t: None, recorder)(_Thread(alive=alive), ASKED)

    assert _recorded(join) == expected


def _expiring_popen_wait(recorder: object) -> None:
    sleep = PROBE.timed_sleep(lambda _s: None, recorder)
    command = "fake"

    def wait(_process: object, timeout: float | None = None) -> int:
        sleep(ASKED)
        raise subprocess.TimeoutExpired(command, timeout or 0.0)

    with pytest.raises(subprocess.TimeoutExpired):
        PROBE.timed_popen_wait(wait, recorder)(object(), ASKED)


def test_a_popen_wait_that_expires_counts_once_whatever_it_sleeps_inside() -> None:
    assert _recorded(_expiring_popen_wait) == {NODE: {"Popen.wait": ASKED}}


@pytest.mark.parametrize(
    ("node", "expected"), [(NODE, {NODE: {"time.sleep": ASKED}}), (None, {})], ids=["in", "outside"]
)
def test_a_wait_is_recorded_against_the_running_test_and_not_outside_one(
    *, node: str | None, expected: Recorded
) -> None:
    assert _recorded(lambda recorder: PROBE.timed_sleep(lambda _s: None, recorder)(ASKED), node=node) == expected
