"""Connect-time tolerance, through ``run()`` with both fake daemons: a dead 8088
lane must leave no fabricated file truth behind (docs/testing.md — every fault is
injected at the wire or via constructor inputs)."""

from typing import Any

from conftest import StartManager

# --- 8088 faults must not fail the 4321 connect -------------------------------


async def test_a_dead_http_lane_leaves_file_config_unset(
    start_manager: StartManager, closed_port: int, http_daemon: dict[str, Any]
) -> None:
    # the failed read is tolerated and leaves no fabricated file truth behind
    dead = await start_manager(closed_port)
    live = await start_manager(http_daemon["_port"])
    assert (dead.readings.file_config, live.readings.file_config is not None) == (None, True)


async def test_a_live_http_lane_sets_file_config_title(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    # an ordinary live 8088 lane grounds file_config from the real file
    http_daemon["title"] = "Grounded from file"
    live = await start_manager(http_daemon["_port"])
    assert (live.readings.file_config or {})["title"] == "Grounded from file"
