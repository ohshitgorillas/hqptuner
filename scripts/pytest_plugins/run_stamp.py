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
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

#: pytest finds the hook below by name, never by reference; naming it here is
#: what tells a static dead-code sweep it is live.
__all__ = ["pytest_sessionstart"]

#: The stamp, in the run's root directory.
STAMP_NAME = ".pytest-run.json"


def pytest_sessionstart(session: pytest.Session) -> None:
    """Write the stamp: the run's start, in seconds since the epoch."""
    stamp = session.config.rootpath / STAMP_NAME
    stamp.write_text(json.dumps({"start": time.time()}) + "\n", encoding="utf-8")
