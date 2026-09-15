#!/usr/bin/env python3
"""Pytest plugin: record how long each test spent waiting rather than working.

Wall time comes from ``time.perf_counter``; CPU time from ``time.process_time``
plus the children this process reaped, so a test that shells out is credited
with the work it caused. The difference is the idle: the seconds a test held
the suite without spending a core on it.

The plugin measures and writes; it judges nothing. ``scripts/gates/check_idle.py``
reads the report it leaves and holds each test to a threshold. The report is
stamped with the session's exit status, because a failing test often waits out
a deadline instead of returning on an event, and those seconds say nothing about
what the test costs when it passes.

Loaded by ``-p idle_probe`` with ``scripts`` on ``PYTHONPATH``; the Makefile's
``test`` recipe and the ``pytest-offline`` pre-commit hook are the two command
lines that do so, and both run the whole offline suite.
"""

from __future__ import annotations

import json
import resource
import time
from typing import TYPE_CHECKING

import pytest

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


def idle(wall_start: float, wall_end: float, cpu_start: float, cpu_end: float) -> float:
    """Return the seconds between the two wall readings that no CPU was spent on.

    Rounded to microseconds, so a recorded number reads as the measurement
    rather than as its float residue, and clamped at zero: CPU is counted
    process-wide across threads, so a test driving a portal thread can be
    credited with more CPU than it held wall time.
    """
    return max(0.0, round((wall_end - wall_start) - (cpu_end - cpu_start), 6))


def record(nodeid: str, seconds: float) -> None:
    """Record ``seconds`` of idle against ``nodeid``, replacing any earlier reading."""
    _RECORDED[nodeid] = seconds


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item) -> Generator[None, None, None]:
    """Time one test, setup and teardown included, and record its idle."""
    wall_start = time.perf_counter()
    cpu_start = cpu_seconds()
    yield
    record(item.nodeid, idle(wall_start, time.perf_counter(), cpu_start, cpu_seconds()))


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Write the report into the session's rootdir, stamped with its exit status."""
    report = {"exitstatus": int(exitstatus), "tests": dict(_RECORDED)}
    path = session.config.rootpath / REPORT_NAME
    path.write_text(json.dumps(report) + "\n", encoding="utf-8")
