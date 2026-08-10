"""Connect-time tolerance and preset migration, through ``run()`` with both fake
daemons: a failed file-config read (unusable /backup) or a dead 8088 lane must
never fail the 4321 connect, and a fresh connect imports the daemon's own preset
snapshots into the store (docs/testing.md — every fault is injected at the wire
or via constructor inputs)."""

import asyncio
from collections.abc import AsyncIterator, Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import eventually

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

StartManager = Callable[..., Coroutine[Any, Any, ConnectionManager]]


@pytest.fixture
def empty_backup_daemon() -> Iterator[dict[str, Any]]:
    # the 6.0.4 bug window: /backup serves a bare data/ with no working config
    yield from fake_http.spawn(fake_http.state(_empty=True))


async def _settled(manager: ConnectionManager) -> None:
    """A full connect plus one completed poll. ``run()`` flags the daemon
    reachable before the best-effort 8088 loads run, so the flag alone cannot
    prove the connect returned whole — a completed poll can."""

    await eventually(lambda: manager.reachable and manager.loaded_at is not None, timeout=5.0)
    first = manager.loaded_at
    await eventually(lambda: manager.reachable and manager.loaded_at != first, timeout=5.0)


@pytest.fixture
async def start_manager(live_daemon_port: int, tmp_path: Path) -> AsyncIterator[StartManager]:
    """Run a manager against the 4321 fake plus an 8088 lane at ``http_port``,
    waiting until it has settled; everything is torn down at exit."""
    started: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def start(http_port: int, **overrides: Any) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": live_daemon_port,
            "poll_interval": 0.02,
            "backup_dir": tmp_path / "backups",
            "preset_dir": tmp_path / "presets",
        }
        manager = ConnectionManager(Config(**{**defaults, **overrides}), http)
        task = asyncio.create_task(manager.run())
        started.append((manager, task, http))
        await _settled(manager)
        return manager

    yield start
    for manager, task, http in started:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


# --- 8088 faults must not fail the 4321 connect -------------------------------


async def test_an_unusable_backup_does_not_fail_the_connect(
    start_manager: StartManager, empty_backup_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(empty_backup_daemon["_port"])
    assert manager.reachable is True


async def test_a_dead_http_lane_leaves_file_config_unset(start_manager: StartManager, closed_port: int) -> None:
    # the failed read is tolerated AND leaves no fabricated file truth behind
    manager = await start_manager(closed_port)
    assert manager.file_config is None


async def test_a_dead_http_lane_does_not_fail_the_connect(start_manager: StartManager, closed_port: int) -> None:
    manager = await start_manager(closed_port)
    assert manager.reachable is True


async def test_a_dead_http_lane_records_the_form_error(start_manager: StartManager, closed_port: int) -> None:
    manager = await start_manager(closed_port)
    assert manager.config_error is not None


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
