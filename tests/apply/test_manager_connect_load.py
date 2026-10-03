"""Connect-time tolerance, through ``run()`` with both fake daemons: a dead 8088
lane must leave no fabricated file truth behind (docs/testing.md — every fault is
injected at the wire or via constructor inputs)."""

from typing import Any

import pytest
from conftest import StartManager

from hqptuner.core.manager import ConnectionManager

TITLE = "Grounded from file"


def _file_title(manager: ConnectionManager) -> str | None:
    """The title the manager grounded from the daemon's file, or None while it grounded no file."""
    file_config = manager.readings.file_config
    return None if file_config is None else file_config["title"]


# --- 8088 faults must not fail the 4321 connect -------------------------------


@pytest.mark.parametrize(("lane", "title"), [("dead", None), ("live", TITLE)])
async def test_file_config_is_grounded_only_from_a_live_http_lane(
    start_manager: StartManager, closed_port: int, http_daemon: dict[str, Any], lane: str, title: str | None
) -> None:
    # the failed read is tolerated and leaves no fabricated file truth behind, while
    # an ordinary live 8088 lane grounds file_config from the real file
    http_daemon["title"] = TITLE
    manager = await start_manager(closed_port if lane == "dead" else http_daemon["_port"])
    assert _file_title(manager) == title
