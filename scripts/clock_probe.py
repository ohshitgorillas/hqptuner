#!/usr/bin/env python3
"""Pytest plugin: record each real-clock timeout that ran out while a test held the suite.

A wait on a real clock ends one of two ways: the thing it waits for arrives, or
its timeout expires. Only the second is a wait on the clock, so only the second
is recorded, and what is recorded is the timeout the caller asked for rather
than the time that passed. The reading is a property of the code and reads the
same on any machine.

Wrapped while the session runs: ``time.sleep`` above zero, every event loop
timer that fires (``asyncio.sleep``, ``wait_for``, ``asyncio.timeout``),
``threading.Condition.wait`` (``Event.wait``, ``Queue.get``),
``threading.Thread.join`` and ``subprocess.Popen.wait``. Not seen: a C-level
``lock.acquire(timeout=...)`` called directly, a socket timeout, a ``select``
with a timeout outside an event loop, and a ``sleep`` bound by name before the
plugin loads. The idle gate covers those on the development host.

The plugin measures and writes; ``scripts/gates/check_clock_waits.py`` judges.
Loaded by ``-p clock_probe`` with ``scripts`` on ``PYTHONPATH``, on the same
two whole-suite command lines that load the idle probe.
"""

from __future__ import annotations

import asyncio.base_events
import contextlib
import json
import subprocess
import threading
import time
from typing import TYPE_CHECKING, Protocol

import pytest

if TYPE_CHECKING:
    from collections.abc import Callable, Generator, Iterator
    from contextvars import Context

#: pytest finds the hooks below by name, never by reference; naming them here is
#: what tells a static dead-code sweep they are live.
__all__ = ["pytest_configure", "pytest_runtest_protocol", "pytest_sessionfinish", "pytest_unconfigure"]

#: Written into the run's rootdir at session finish.
REPORT_NAME = ".clock-probe.json"


class Clocked(Protocol):
    """An event loop, as far as a timer's delay needs one."""

    def time(self) -> float:
        """Return the loop's clock."""
        ...


class Joinable(Protocol):
    """A thread, as far as a timed join needs one."""

    def is_alive(self) -> bool:
        """Return whether the thread is still running."""
        ...


class Recorder:
    """Seconds of expired timeout per test and per kind of wait."""

    def __init__(self) -> None:
        """Start with no test running and nothing recorded."""
        self.current: str | None = None
        self.tests: dict[str, dict[str, float]] = {}
        self._local = threading.local()

    def add(self, kind: str, seconds: float) -> None:
        """Record ``seconds`` of ``kind`` against the running test, unless inside a wait already counted."""
        node = self.current
        depth: int = getattr(self._local, "depth", 0)
        if node is None or seconds <= 0 or depth:
            return
        bucket = self.tests.setdefault(node, {})
        bucket[kind] = round(bucket.get(kind, 0.0) + seconds, 6)

    @contextlib.contextmanager
    def counted(self) -> Iterator[None]:
        """Hold off recording on this thread while a wait that counts itself runs."""
        self._local.depth = getattr(self._local, "depth", 0) + 1
        try:
            yield
        finally:
            self._local.depth -= 1


def timed_sleep(original: Callable[[float], None], recorder: Recorder) -> Callable[[float], None]:
    """Wrap ``time.sleep``: every sleep above zero runs its full length."""

    def sleep(seconds: float) -> None:
        recorder.add("time.sleep", seconds)
        original(seconds)

    return sleep


def timed_call_at[R](original: Callable[..., R], recorder: Recorder) -> Callable[..., R]:
    """Wrap ``BaseEventLoop.call_at``: a timer counts its delay when it fires, nothing when cancelled."""

    def call_at(
        loop: Clocked, when: float, callback: Callable[..., object], *args: object, context: Context | None = None
    ) -> R:
        delay = when - loop.time()

        def fired(*fired_args: object) -> object:
            recorder.add("loop timer", delay)
            return callback(*fired_args)

        return original(loop, when, fired, *args, context=context)

    return call_at


def timed_condition_wait[T](
    original: Callable[[T, float | None], bool], recorder: Recorder
) -> Callable[[T, float | None], bool]:
    """Wrap ``Condition.wait``: a False return under a timeout is the timeout running out."""

    def wait(condition: T, timeout: float | None = None) -> bool:
        satisfied = original(condition, timeout)
        if not satisfied and timeout is not None:
            recorder.add("Condition.wait", timeout)
        return satisfied

    return wait


def timed_join[T: Joinable](
    original: Callable[[T, float | None], None], recorder: Recorder
) -> Callable[[T, float | None], None]:
    """Wrap ``Thread.join``: a thread still alive after a timed join outlived the timeout."""

    def join(thread: T, timeout: float | None = None) -> None:
        original(thread, timeout)
        if timeout is not None and thread.is_alive():
            recorder.add("Thread.join", timeout)

    return join


def timed_popen_wait[T](
    original: Callable[[T, float | None], int], recorder: Recorder
) -> Callable[[T, float | None], int]:
    """Wrap ``Popen.wait``: ``TimeoutExpired`` is the timeout running out, counted once."""

    def wait(process: T, timeout: float | None = None) -> int:
        try:
            with recorder.counted():
                return original(process, timeout)
        except subprocess.TimeoutExpired:
            recorder.add("Popen.wait", timeout or 0.0)
            raise

    return wait


RECORDER = Recorder()

#: The originals ``pytest_unconfigure`` puts back, by owner and attribute name.
_ORIGINALS: list[tuple[object, str, object]] = []


def _replace(owner: object, name: str, wrapper: object) -> None:
    _ORIGINALS.append((owner, name, getattr(owner, name)))
    setattr(owner, name, wrapper)


def pytest_configure() -> None:
    """Install every wrapper before the first test runs."""
    loop = asyncio.base_events.BaseEventLoop
    _replace(time, "sleep", timed_sleep(time.sleep, RECORDER))
    _replace(loop, "call_at", timed_call_at(loop.call_at, RECORDER))
    _replace(threading.Condition, "wait", timed_condition_wait(threading.Condition.wait, RECORDER))
    _replace(threading.Thread, "join", timed_join(threading.Thread.join, RECORDER))
    _replace(subprocess.Popen, "wait", timed_popen_wait(subprocess.Popen.wait, RECORDER))


def pytest_unconfigure() -> None:
    """Put every original back."""
    while _ORIGINALS:
        owner, name, original = _ORIGINALS.pop()
        setattr(owner, name, original)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item) -> Generator[None, None, None]:
    """Attribute every wait from setup to teardown to this test."""
    RECORDER.current = item.nodeid
    RECORDER.tests.setdefault(item.nodeid, {})
    yield
    RECORDER.current = None


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Write the report into the session's rootdir, stamped with its exit status."""
    report = {"exitstatus": int(exitstatus), "tests": RECORDER.tests}
    path = session.config.rootpath / REPORT_NAME
    path.write_text(json.dumps(report) + "\n", encoding="utf-8")
