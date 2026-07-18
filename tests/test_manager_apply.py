"""ConnectionManager write path through its public API (docs/testing.md).

The happy path runs the manager against the real-socket fake daemon: it
connects on its own, applies a live edit, and the report reflects the
State readback the daemon actually returns."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from hqptuner.config import Config
from hqptuner.control import ControlError
from hqptuner.manager import ConnectionManager


async def _until_reachable(manager: ConnectionManager, timeout: float = 2.0) -> None:
    async def wait() -> None:
        while not manager.reachable:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), timeout)


@pytest.fixture
async def running_manager(live_daemon_port: int) -> AsyncIterator[ConnectionManager]:
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=live_daemon_port))
    task = asyncio.create_task(manager.run())
    await _until_reachable(manager)
    yield manager
    manager.stop()
    await task
    await manager.aclose()


async def test_live_edit_applies_and_verifies(running_manager: ConnectionManager) -> None:
    report = await running_manager.apply({"shaper": {"value": "5"}}, {})
    assert report["live"][0]["ok"] is True


async def test_live_edit_without_connection_raises() -> None:
    manager = ConnectionManager(Config())
    with pytest.raises(ControlError, match="not connected"):
        await manager.apply({"shaper": {"value": "5"}}, {})


async def test_http_edit_without_credentials_reports_error() -> None:
    manager = ConnectionManager(Config())  # no http client configured
    report = await manager.apply({}, {"channels": "2"})
    assert report["http"]["submitted"] is False
