"""The ``switch_to`` apply path, the ``apply_engine`` error returns, and
``persist_backup``'s write-or-abort backup persistence — all driven through the
public API against the faithful fake daemon (docs/testing.md)."""

import contextlib
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ManagerFactory
from narrow import present

from hqptuner.conf.httpauth import HttpLaneDeclinedError
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane
from hqptuner.presets.presetops import BackupFailedError

# --- apply with switch_to: load the previewed preset, then the edits ----------


async def test_apply_with_switch_to_reports_the_loaded_preset(http_manager: ConnectionManager) -> None:
    await http_manager.presetops.save_preset("Base")
    report = await http_manager.applyops.apply({}, {}, switch_to="Base")
    assert report.switched == presetlane.PresetActivation(name="Base")


async def test_apply_with_switch_to_restores_the_presets_config(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    await http_manager.presetops.save_preset("Base")
    await http_manager.applyops.apply({}, {"title": "Drift"})
    await http_manager.applyops.apply({}, {}, switch_to="Base")
    assert http_daemon["title"] == "Opal"


async def test_apply_with_switch_to_lands_staged_edits_on_top_of_the_preset(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    await http_manager.presetops.save_preset("Base")
    await http_manager.applyops.apply({}, {"title": "Tweaked"}, switch_to="Base")
    assert http_daemon["title"] == "Tweaked"


# --- the [default] preset read serves the running config ----------------------


async def test_reading_the_default_preset_serves_the_running_config(http_manager: ConnectionManager) -> None:
    assert (await presetlane.read(http_manager, ""))["title"] == "Opal"


# --- apply_engine error returns ------------------------------------------------


async def test_apply_engine_without_credentials_declines_the_http_lane(http_manager: ConnectionManager) -> None:
    http_manager.http_client = None
    with pytest.raises(HttpLaneDeclinedError):
        await http_manager.applyops.apply_engine({"cuda": "0"})


@pytest.fixture
def dead_lane_manager(http_daemon: dict[str, Any], http_manager: ConnectionManager) -> ConnectionManager:
    """A ready manager whose 8088 lane is then taken away."""
    http_daemon["_take_lane_down"]()
    return http_manager


async def test_apply_engine_reports_an_unreachable_http_lane(dead_lane_manager: ConnectionManager) -> None:
    with pytest.raises(httpx.HTTPError):
        await dead_lane_manager.applyops.apply_engine({"cuda": "0"})


async def test_a_save_that_cannot_reach_the_daemon_reports_its_failure(dead_lane_manager: ConnectionManager) -> None:
    with pytest.raises(httpx.HTTPError):
        await dead_lane_manager.presetops.save_preset("Studio")


# --- persist_backup: the backup is taken before a destructive restore, so a --
# --- failed write must abort rather than let the restore proceed uncovered --


def test_persist_backup_writes_the_archive_to_disk(http_manager: ConnectionManager) -> None:
    path = http_manager.presetops.persist_backup_for_apply(b"archive-bytes")
    assert present(path).read_bytes() == b"archive-bytes"


async def test_persist_backup_raises_when_the_directory_is_unwritable(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory, tmp_path: Path
) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where the backup dir should be")
    manager = await http_manager_factory(http_daemon, backup_dir=blocker / "backups")
    with pytest.raises(BackupFailedError):
        manager.presetops.persist_backup_for_apply(b"archive-bytes")


async def test_a_failed_backup_aborts_a_load_before_any_restore(
    tmp_path: Path, http_daemon: dict[str, Any], http_manager_factory: ManagerFactory
) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where the backup dir should be")
    manager = await http_manager_factory(http_daemon, backup_dir=blocker / "backups", preset_dir=tmp_path / "presets")
    await manager.presetops.save_preset("Base")  # its own daemon mirror already posts one /restore
    before = http_daemon.get("_restore_attempts", 0)
    with contextlib.suppress(BackupFailedError):
        await presetlane.load(manager, "Base")
    assert http_daemon.get("_restore_attempts", 0) == before
