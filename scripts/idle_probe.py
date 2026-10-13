#!/usr/bin/env python3
"""Pytest plugin: record how long each test spent waiting rather than working.

Wall time comes from ``time.perf_counter``; CPU time from ``time.process_time``
plus the children this process reaped, so a test that shells out is credited
with the work it caused. The third clock is the time the thread running the test
sat ready to run but waiting for a CPU, read by ``run_stamp.cpu_wait``. A test is
charged as idle its wall time less its CPU time less that wait: the seconds it
held the suite without spending a core on it, and without the host holding it
off one.

The plugin measures and writes; it judges nothing. ``scripts/gates/check_idle.py``
reads the report it leaves and fails a test whose idle rises more than 40 ms over
its previous reading on the branch, or exceeds 40 ms with none. The report is
stamped with the session's exit status, because a failing test often waits out
a deadline instead of returning on an event, and those seconds say nothing about
what the test costs when it passes.

Loaded by ``-p idle_probe`` with ``scripts`` and ``scripts/pytest_plugins`` on
``PYTHONPATH``; the Makefile's ``pytest-offline`` target is the one command
line that does so, and it runs the whole offline suite for both ``make test``
and the ``pytest-offline`` pre-commit hook.
"""

from __future__ import annotations

import json
import resource
import threading
import time
from typing import TYPE_CHECKING, NamedTuple

import pytest
import run_stamp

if TYPE_CHECKING:
    from collections.abc import Generator

#: pytest finds the hooks below by name, never by reference; naming them here is
#: what tells a static dead-code sweep they are live (the house pattern, as in
#: the environment probe beside the suite).
__all__ = ["pytest_runtest_protocol", "pytest_sessionfinish"]

#: Written into the run's rootdir at session finish.
REPORT_NAME = ".idle-probe.json"

#: Node id to idle seconds, filled as the session runs.
_RECORDED: dict[str, float] = {}


def cpu_seconds() -> float:
    """Return this process's CPU time plus its reaped children's, in seconds."""
    children = resource.getrusage(resource.RUSAGE_CHILDREN)
    return time.process_time() + children.ru_utime + children.ru_stime


class Reading(NamedTuple):
    """The three clocks at one instant, in seconds."""

    wall: float
    cpu: float
    cpu_wait: float


def read(thread: int) -> Reading:
    """Return the three clocks now, the CPU-wait being that of ``thread``."""
    return Reading(time.perf_counter(), cpu_seconds(), run_stamp.cpu_wait(thread))


def idle(start: Reading, end: Reading) -> float:
    """Return the seconds between two readings that no CPU was spent on or waited for.

    Rounded to microseconds, so a recorded number reads as the measurement
    rather than as its float residue, and clamped at zero: CPU is counted
    process-wide across threads, so a test driving a portal thread can be
    credited with more CPU than it held wall time.
    """
    wall = end.wall - start.wall
    cpu = end.cpu - start.cpu
    waited = end.cpu_wait - start.cpu_wait
    return max(0.0, round(wall - cpu - waited, 6))


def record(nodeid: str, seconds: float) -> None:
    """Record ``seconds`` of idle against ``nodeid``, replacing any earlier reading."""
    _RECORDED[nodeid] = seconds


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item) -> Generator[None, None, None]:
    """Time one test, setup and teardown included, and record its idle."""
    thread = threading.get_native_id()
    start = read(thread)
    yield
    record(item.nodeid, idle(start, read(thread)))


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Write the report into the session's rootdir, stamped with its exit status."""
    report = {"exitstatus": int(exitstatus), "tests": dict(_RECORDED)}
    path = session.config.rootpath / REPORT_NAME
    path.write_text(json.dumps(report) + "\n", encoding="utf-8")
