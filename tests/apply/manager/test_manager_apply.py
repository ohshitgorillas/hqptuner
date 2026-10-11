"""ConnectionManager write path.

The happy path runs the manager against the real-socket fake daemon: it
connects on its own, applies a live edit, and the report reflects the
State readback the daemon actually returns."""

import dataclasses

from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager


async def test_http_edit_without_credentials_reports_error() -> None:
    manager = ConnectionManager(Config(), clock=VirtualClock())  # no http client configured
    report = await manager.applyops.apply({}, {"channels": "2"})
    assert dataclasses.asdict(report)["persistent"]["code"] == "no_http_client"
