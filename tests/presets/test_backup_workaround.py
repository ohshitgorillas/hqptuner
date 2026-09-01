"""The 6.0.4 empty-backup workaround (docs/protocol.md §3.6,
``manager.presetops.backup_or_cached``) plus the write-path edges around it: a write
refuses to build a restore on an unusable archive, a read falls back to the last
healthy one, and with no cache the archive passes through for the caller's own
error. Also the ``switch_to`` apply path, the ``apply_engine`` error returns, and
``persist_backup``'s best-effort disk write — all driven through the public API
against the faithful fake daemon (docs/testing.md)."""

import io
import zipfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from narrow import present

from hqptuner.conf import xmledit
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

# --- backup_or_cached: the workaround itself ----------------------------------


async def test_a_write_refuses_the_cached_fallback_too(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    # a cached archive is stale — a restore built on it resurrects old settings
    await http_manager.presetops.backup_or_cached()  # cache warmed while healthy
    http_daemon["_empty"] = True
    with pytest.raises(xmledit.GroundingError):
        await http_manager.presetops.backup_or_cached(for_write=True)


async def test_a_read_falls_back_to_the_cached_archive(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    healthy = await http_manager.presetops.backup_or_cached()
    http_daemon["_empty"] = True
    assert await http_manager.presetops.backup_or_cached() == healthy


async def test_a_read_with_no_cache_passes_the_archive_through(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    # nothing healthy was ever seen — the caller gets the truth, not an invention
    http_daemon["_empty"] = True
    passed_through = await http_manager.presetops.backup_or_cached()
    assert zipfile.ZipFile(io.BytesIO(passed_through)).namelist() == ["data/"]


async def test_a_healthy_backup_is_cached_for_the_outage(http_manager: ConnectionManager) -> None:
    await http_manager.presetops.backup_or_cached()
    assert http_manager.presetops.last_healthy_backup is not None


# --- apply with switch_to: load the previewed preset, then the edits ----------


async def test_apply_with_switch_to_reports_the_loaded_preset(http_manager: ConnectionManager) -> None:
    await http_manager.presetops.save_preset("Base")
    report = await http_manager.applyops.apply({}, {}, switch_to="Base")
    assert report["switched"]["name"] == "Base"


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


async def test_apply_engine_without_credentials_reports_not_submitted() -> None:
    manager = ConnectionManager(Config())
    result = await manager.applyops.apply_engine({"cuda": "0"})
    assert result["submitted"] is False


@pytest.fixture
async def dead_lane_manager(closed_port: int, tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    """A manager whose 8088 lane points at a port nothing serves."""
    http = HttpConfigClient("127.0.0.1", closed_port, "u", "p")
    manager = ConnectionManager(Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets"), http)
    yield manager
    await http.aclose()


async def test_apply_engine_reports_an_unreachable_http_lane(dead_lane_manager: ConnectionManager) -> None:
    result = await dead_lane_manager.applyops.apply_engine({"cuda": "0"})
    assert result["submitted"] is False


async def test_a_save_that_cannot_reach_the_daemon_reports_not_ok(dead_lane_manager: ConnectionManager) -> None:
    result = await dead_lane_manager.presetops.save_preset("Studio")
    assert result["ok"] is False


# --- persist_backup: best-effort, never blocks the apply -----------------------


def test_persist_backup_writes_the_archive_to_disk(tmp_path: Path) -> None:
    manager = ConnectionManager(Config(backup_dir=tmp_path / "backups", preset_dir=tmp_path / "presets"))
    path = manager.presetops.persist_backup(b"archive-bytes")
    assert present(path).read_bytes() == b"archive-bytes"


def test_persist_backup_tolerates_an_unwritable_directory(tmp_path: Path) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("a file where the backup dir should be")
    manager = ConnectionManager(Config(backup_dir=blocker / "backups", preset_dir=tmp_path / "presets"))
    assert manager.presetops.persist_backup(b"archive-bytes") is None
