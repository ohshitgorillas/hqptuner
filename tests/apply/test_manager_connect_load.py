"""Connect-time tolerance, through ``run()`` with both fake daemons: a dead 8088
lane must leave no fabricated file truth behind (docs/testing.md — every fault is
injected at the wire or via constructor inputs)."""

from conftest import StartManager

# --- 8088 faults must not fail the 4321 connect -------------------------------


async def test_a_dead_http_lane_leaves_file_config_unset(start_manager: StartManager, closed_port: int) -> None:
    # the failed read is tolerated AND leaves no fabricated file truth behind
    manager = await start_manager(closed_port)
    assert manager.readings.file_config is None
