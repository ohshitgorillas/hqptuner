#!/usr/bin/env python3
"""Pytest plugin: abort an offline run once it is past the suite-time gate's bar.

``scripts/gates/testing/check_suite_time.py`` rejects a run ``REJECT`` seconds or
more slower than the last green run, but it judges the junit report, so it only
sees a run that ended; a hung suite never reaches it. This plugin holds the run
to the same bar while it is still going: at session start it reads the same
baseline, and a run still going at the bar has every thread's stack dumped to
stderr and the process ended with exit status 1. With no baseline recorded there
is no deadline.

Loaded by ``-p suite_deadline`` with ``scripts/pytest_plugins`` on ``PYTHONPATH``; the Makefile's
``test`` recipe and the ``pytest-offline`` pre-commit hook are the two command
lines that do so.
"""

from __future__ import annotations

import faulthandler
import importlib.util
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, TextIO

if TYPE_CHECKING:
    from collections.abc import Callable
    from types import ModuleType

    import pytest

#: pytest finds the hooks below by name, never by reference; naming them here is
#: what tells a static dead-code sweep they are live.
__all__ = ["pytest_sessionfinish", "pytest_sessionstart"]

#: The suite-time gate, found by path: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parent.parent / "gates" / "testing" / "check_suite_time.py"


class GateImportError(RuntimeError):
    """The suite-time gate could not be loaded from its path."""

    def __init__(self, *, gate_path: Path) -> None:
        """Name the `gate_path` that failed to load."""
        super().__init__(f"cannot import gate at {gate_path}")


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_suite_time_for_deadline", GATE_PATH)
    if spec is None or spec.loader is None:
        raise GateImportError(gate_path=GATE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_GATE = _load_gate()
REJECT: float = _GATE.REJECT
baseline_path: Callable[[Path], Path] = _GATE.baseline_path
read_baseline: Callable[[Path], float | None] = _GATE.read_baseline

#: Set at session finish, so a run that ends in time disarms the watch.
_FINISHED = threading.Event()
#: The stream the armed watch dumps to, closed at session finish.
_ARMED: list[TextIO] = []


class Finished(Protocol):
    """A run's finish signal; ``threading.Event`` is one."""

    def wait(self, timeout: float) -> bool: ...


def deadline(baseline: Path) -> float | None:
    """Return the seconds after session start at which the run is aborted, or None with no baseline."""
    last = read_baseline(baseline)
    return None if last is None else last + REJECT


def watch(seconds: float, finished: Finished, *, dump_to: TextIO, terminate: Callable[[int], None]) -> None:
    """Give the run ``seconds`` to finish; one still going is dumped, every thread, and terminated with 1."""
    if finished.wait(seconds):
        return
    dump_to.write(f"suite deadline: still running {seconds:.1f}s after session start, aborted\n")
    dump_to.flush()
    faulthandler.dump_traceback(file=dump_to, all_threads=True)
    terminate(1)


def pytest_sessionstart(session: pytest.Session) -> None:
    """Arm the watch against the gate's baseline for this branch; with none recorded, arm nothing.

    Capture is suspended at session start, so fd 2 is still the terminal; the
    watch dumps to a copy of it, which capture taking fd 2 over for each test
    leaves alone.
    """
    seconds = deadline(baseline_path(session.config.rootpath))
    if seconds is None:
        return
    stderr = os.fdopen(os.dup(2), "w")
    _ARMED.append(stderr)
    threading.Thread(
        target=watch,
        args=(seconds, _FINISHED),
        kwargs={"dump_to": stderr, "terminate": os._exit},
        name="suite-deadline",
        daemon=True,
    ).start()


def pytest_sessionfinish() -> None:
    """Disarm the watch: the run finished in time."""
    _FINISHED.set()
    while _ARMED:
        _ARMED.pop().close()
