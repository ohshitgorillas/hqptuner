#!/usr/bin/env python3
"""Pytest plugin: record the hqplayerd release a green live run passed against.

A run that exits 0 with at least one ``live``-marked test passed and none
skipped adds the release the daemon's /about page reports to
``hqptuner/data/tested-releases.json`` under the run's rootdir, once. The app
reads that record to decide whether the System tab flags the daemon's release
as untested. A failed run, a skipped canary or a run with the live tests
deselected records nothing; a green run that still records nothing says why.

The daemon address is taken from the shell's ``HQPTUNER_*`` values when the
plugin is configured, before any suite fixture re-points it. Run state lives on
the run's own config, so a suite that runs pytest in-process with this plugin
loaded does not disturb the outer run.

Loaded by ``-p tested_release`` with ``scripts/pytest_plugins`` on ``PYTHONPATH``;
the Makefile's ``test-live`` recipe is the command line that does so.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest

from hqptuner.config import Config
from hqptuner.engine.release import fetch_about, parse_release
from hqptuner.metadata_json import str_list

if TYPE_CHECKING:
    from collections.abc import Generator

#: pytest finds the hooks below by name, never by reference; naming them here is
#: what tells a static dead-code sweep they are live.
__all__ = ["pytest_configure", "pytest_runtest_makereport", "pytest_sessionfinish"]

#: Where the record sits relative to the rootdir of the run that keeps it.
RECORD = Path("hqptuner") / "data" / "tested-releases.json"


@dataclass
class _Run:
    """The daemon address the run started with and its live tests' outcomes so far."""

    base_url: str
    passed: int = 0
    skipped: int = 0


_RUN = pytest.StashKey[_Run]()


def pytest_configure(config: pytest.Config) -> None:
    """Start the run with the daemon address the shell names right now."""
    config.stash[_RUN] = _Run(Config().hqp_http_base_url)


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item: pytest.Item) -> Generator[None, pytest.TestReport, pytest.TestReport]:
    """Count a live test's skip, or its pass once its call phase is through."""
    report = yield
    if item.get_closest_marker("live") is not None:
        run = item.config.stash[_RUN]
        if report.skipped:
            run.skipped += 1
        elif report.when == "call" and report.passed:
            run.passed += 1
    return report


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Add the daemon's release to the record when the run ended green with its live tests run."""
    run = session.config.stash[_RUN]
    if exitstatus != 0 or not run.passed or run.skipped:
        return
    try:
        release = parse_release(asyncio.run(fetch_about(run.base_url)))
    except httpx.HTTPError as err:
        print(f"\ntested_release: reading {run.base_url}/about failed ({err}); record unchanged")
        return
    if not release:
        print(f"\ntested_release: {run.base_url}/about names no release; record unchanged")
        return
    path = session.config.rootpath / RECORD
    recorded = str_list(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else []
    if release not in recorded:
        path.write_text(json.dumps(sorted([*recorded, release])) + "\n", encoding="utf-8")
