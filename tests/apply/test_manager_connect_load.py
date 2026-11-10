"""Connect-time tolerance, through ``run()`` with both fake daemons: a dead 8088
lane must leave no fabricated file truth behind (docs/testing.md — every fault is
injected at the wire or via constructor inputs)."""

from typing import Any

import pytest
from apps import settled
from conftest import StartManager
from virtual_clock import VirtualClock

from hqptuner.core.manager import ConnectionManager

TITLE = "Grounded from file"


def _file_title(manager: ConnectionManager) -> str | None:
    """The title the manager grounded from the daemon's file, or None while it grounded no file."""
    file_config = manager.readings.file_config
    return None if file_config is None else file_config["title"]


# --- 8088 faults must not fail the 4321 connect -------------------------------


async def test_file_config_is_grounded_from_the_live_http_lane(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["title"] = TITLE
    manager = await start_manager(http_daemon["_port"])
    assert _file_title(manager) == TITLE


async def _reconnected(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock, *, lane_down: bool
) -> ConnectionManager:
    """A manager that started ready, then made a fresh 4321 connect, with the 8088 lane taken down first or left up."""
    manager = await start_manager(http_daemon["_port"])
    if lane_down:
        http_daemon["_take_lane_down"]()
    await manager.restarting()
    await settled(clock)
    return manager


async def test_a_connect_made_with_the_8088_lane_down_still_completes_the_4321_connect(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock
) -> None:
    manager = await _reconnected(start_manager, http_daemon, clock, lane_down=True)
    assert manager.connected.is_set()


@pytest.mark.parametrize(("lane_down", "ready"), [(False, True), (True, False)], ids=["8088 stands", "8088 down"])
async def test_a_fresh_connect_leaves_the_manager_ready_only_while_the_8088_lane_stands(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock, *, lane_down: bool, ready: bool
) -> None:
    manager = await _reconnected(start_manager, http_daemon, clock, lane_down=lane_down)
    assert manager.ready is ready
