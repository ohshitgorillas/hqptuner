"""Live matrix-profile switch (``matrixlane.switch_profile``) through the
public surface against the wire fakes: 4321 ``MatrixSetProfile`` plus a State
readback for the new active name, then an 8088 form resync — no engine reload,
no restore, and a hard error when the daemon is not connected."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from conftest import eventually
from narrow import present

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlError
from hqptuner.lanes import matrixlane


@pytest.fixture
async def switch_manager(
    live_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[ConnectionManager]:
    """Connected to both fakes. The poll interval is parked far out so a form
    refresh observed after a switch is the switch's own resync, not the poll's."""
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    manager = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            hqp_control_port=live_daemon_port,
            poll_interval=30.0,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        ),
        http,
    )
    task = asyncio.create_task(manager.run())

    await eventually(lambda: manager.reachable, timeout=3.0)
    yield manager
    manager.stop()
    await task
    await manager.aclose()
    await http.aclose()


async def test_switch_reports_the_new_active_profile(switch_manager: ConnectionManager) -> None:
    result = await matrixlane.switch_profile(switch_manager, "Mch-to-Stereo mixdown")
    assert result["active"] == "Mch-to-Stereo mixdown"


async def test_switch_updates_the_state_snapshot(switch_manager: ConnectionManager) -> None:
    await matrixlane.switch_profile(switch_manager, "Mch-to-Stereo mixdown")
    assert present(switch_manager.state)["matrix_profile"] == "Mch-to-Stereo mixdown"


async def test_switch_resyncs_the_matrix_form(switch_manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    # the daemon's /matrix page follows the live switch; the manager's cached
    # form must follow it too, without waiting for the next poll
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    await matrixlane.switch_profile(switch_manager, "Mch-to-Stereo mixdown")
    assert present(switch_manager.matrix_form)["active"] == "Mch-to-Stereo mixdown"


async def test_switch_without_a_connection_raises() -> None:
    manager = ConnectionManager(Config())
    with pytest.raises(ControlError, match="not connected"):
        await matrixlane.switch_profile(manager, "Default")
