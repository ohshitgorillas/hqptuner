"""HQPTuner-owned preset lifecycle (docs/testing.md).

Two layers: the pure ``presetconf`` archive helpers (bytes in, bytes out), and
the manager's save/load/list/delete through the faithful fake config daemon —
the same wire contract the apply tests use, so a preset only round-trips if the
restore archive is one the real daemon would accept."""

import io
import zipfile
from pathlib import Path
from typing import Any

from hqptuner import presetconf
from hqptuner.config import Config
from hqptuner.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


def _zip(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, body in members.items():
            z.writestr(name, body)
    return out.getvalue()


def _member(zip_bytes: bytes, name: str) -> bytes:
    return zipfile.ZipFile(io.BytesIO(zip_bytes)).read(name)


# --- presetconf archive helpers -------------------------------------------


def test_restore_zip_sets_the_default_working_config() -> None:
    archive = presetconf.restore_zip_with_working(_zip({"hqplayerd.xml": b"<old/>"}), b"<new/>")
    assert _member(archive, "hqplayerd.xml") == b"<new/>"


def test_restore_zip_writes_the_mirror_snapshot() -> None:
    archive = presetconf.restore_zip_with_working(_zip({"hqplayerd.xml": b"<x/>"}), b"<new/>", mirror_name="Speakers")
    assert _member(archive, "data/cfgs/Speakers.xml") == b"<new/>"


def test_restore_zip_inserts_hqplayerd_when_a_named_profile_was_active() -> None:
    # named profile active -> root <Name>.xml, no hqplayerd.xml; restore lands on
    # [default], so hqplayerd.xml must be inserted for it to have a config to run
    archive = presetconf.restore_zip_with_working(_zip({"Speakers.xml": b"<root/>"}), b"<new/>")
    assert _member(archive, "hqplayerd.xml") == b"<new/>"


def test_snapshot_members_extracts_preset_names() -> None:
    zip_bytes = _zip({"hqplayerd.xml": b"<x/>", "data/cfgs/A.xml": b"<a/>", "data/cfgs/B.xml": b"<b/>"})
    assert set(presetconf.snapshot_members(zip_bytes)) == {"A", "B"}


# --- manager preset lifecycle against the fake daemon ----------------------


def _pmgr(daemon: dict[str, Any], tmp_path: Path) -> tuple[ConnectionManager, HttpConfigClient]:
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    cfg = Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    return ConnectionManager(cfg, http), http


async def test_saved_preset_is_listed_and_marked_active(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.save_preset("Studio")
        presets = manager.presets()
    finally:
        await http.aclose()
    assert presets["active"] == "Studio"


async def test_load_preset_restores_its_saved_config(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    # save captures the running config, a later edit drifts it, and loading the
    # preset restores it — proving load drives the daemon back to the saved state
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.save_preset("Base")
        await manager.apply({}, {"title": "Drift"})
        await manager.load_preset("Base")
        title = {f["name"]: f["value"] for f in (await http.get_config())["fields"]}["title"]
    finally:
        await http.aclose()
    assert title == "Opal"


async def test_delete_preset_removes_it_from_the_list(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.save_preset("Temp")
        await manager.delete_preset("Temp")
        names = [o["value"] for o in manager.presets()["options"]]
    finally:
        await http.aclose()
    assert "Temp" not in names
