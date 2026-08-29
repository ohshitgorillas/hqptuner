"""Connect-time tolerance and preset migration, through ``run()`` with both fake
daemons: a failed file-config read (unusable /backup) or a dead 8088 lane must
never fail the 4321 connect, and a fresh connect imports the daemon's own preset
snapshots into the store (docs/testing.md — every fault is injected at the wire
or via constructor inputs)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import StartManager


@pytest.fixture
def empty_backup_daemon() -> Iterator[dict[str, Any]]:
    # the 6.0.4 bug window: /backup serves a bare data/ with no working config
    yield from fake_http.spawn(fake_http.state(_empty=True))


# --- 8088 faults must not fail the 4321 connect -------------------------------


async def test_an_unusable_backup_does_not_fail_the_connect(
    start_manager: StartManager, empty_backup_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(empty_backup_daemon["_port"])
    assert manager.reachable is True


async def test_a_dead_http_lane_leaves_file_config_unset(start_manager: StartManager, closed_port: int) -> None:
    # the failed read is tolerated AND leaves no fabricated file truth behind
    manager = await start_manager(closed_port)
    assert manager.readings.file_config is None


async def test_a_dead_http_lane_does_not_fail_the_connect(start_manager: StartManager, closed_port: int) -> None:
    manager = await start_manager(closed_port)
    assert manager.reachable is True


async def test_a_dead_http_lane_records_the_form_error(start_manager: StartManager, closed_port: int) -> None:
    manager = await start_manager(closed_port)
    assert manager.readings.config_error is not None


async def test_a_failed_preset_migration_does_not_fail_the_connect(
    start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where the preset store wants a directory")
    manager = await start_manager(http_daemon["_port"], preset_dir=blocker / "presets")
    assert manager.reachable is True


# --- migration: the daemon's own snapshots join the store on connect ----------


async def test_connect_imports_the_daemons_preset_snapshots(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(http_daemon["_port"])
    assert "Test" in [o["value"] for o in manager.presetops.presets()["options"]]
