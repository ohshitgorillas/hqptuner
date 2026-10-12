#!/usr/bin/env python3
"""Pytest plugin: stamp the time a run starts, so a gate can tell a report this run wrote from one an earlier run left.

The stamp is written at session start, before collection, so a run that later
crashes or is killed has still stamped; ``scripts/gates/testing/check_fresh_reports.py``
then refuses every report older than it.

Loaded by ``-p run_stamp`` with ``scripts/pytest_plugins`` on ``PYTHONPATH``; the Makefile's
``test`` recipe and the ``pytest-offline`` pre-commit hook are the two command
lines that do so.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

#: pytest finds the hooks below by name, never by reference; naming them here is
#: what tells a static dead-code sweep they are live.
__all__ = ["pytest_sessionfinish", "pytest_sessionstart"]

#: The stamp, in the run's root directory.
STAMP_NAME = ".pytest-run.json"

#: The main thread's native id and its CPU-wait at session start, set by the start hook.
_MAIN: list[tuple[int, float]] = []


def cpu_wait(thread: int) -> float:
    """Return the seconds ``thread`` of this process has sat ready to run but waiting for a CPU.

    The kernel keeps it in nanoseconds as the second field of the thread's
    ``schedstat``. Where there is no such file the reading is zero, and the run
    is judged on its wall time alone.
    """
    schedstat = Path(f"/proc/self/task/{thread}/schedstat")
    if not schedstat.is_file():
        return 0.0
    return int(schedstat.read_text(encoding="utf-8").split()[1]) / 1e9


def main_thread_wait() -> float:
    """Return the seconds the main thread has waited for a CPU since session start; zero before it."""
    if not _MAIN:
        return 0.0
    thread, at_start = _MAIN[0]
    return cpu_wait(thread) - at_start


def pytest_sessionstart(session: pytest.Session) -> None:
    """Write the stamp: the run's start, in seconds since the epoch."""
    thread = threading.get_native_id()
    _MAIN[:] = [(thread, cpu_wait(thread))]
    stamp = session.config.rootpath / STAMP_NAME
    stamp.write_text(json.dumps({"start": time.time()}) + "\n", encoding="utf-8")


def pytest_sessionfinish(session: pytest.Session) -> None:
    """Add the main thread's CPU-wait over the run to the stamp."""
    stamp = session.config.rootpath / STAMP_NAME
    recorded = json.loads(stamp.read_text(encoding="utf-8"))
    recorded["cpu_wait"] = main_thread_wait()
    stamp.write_text(json.dumps(recorded) + "\n", encoding="utf-8")
