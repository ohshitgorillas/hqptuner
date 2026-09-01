"""HQPTuner-owned preset lifecycle (docs/testing.md).

Two layers: the pure ``presetzip`` archive helpers (bytes in, bytes out), and
the manager's save/load/list/delete through the faithful fake config daemon —
the same wire contract the apply tests use, so a preset only round-trips if the
restore archive is one the real daemon would accept."""

import io
import zipfile
from pathlib import Path
from typing import Any

from conftest import ManagerFactory

from hqptuner.conf import presetzip
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

#: A preset name carrying an em dash, the character HQPlayer's charset rules bend around.
DASHED_NAME = "Headphones — ZMF Ori 3.0"


def _zip(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, body in members.items():
            z.writestr(name, body)
    return out.getvalue()


def _member(zip_bytes: bytes, name: str) -> bytes:
    return zipfile.ZipFile(io.BytesIO(zip_bytes)).read(name)


# --- presetzip archive helpers --------------------------------------------


def test_restore_zip_sets_the_default_working_config() -> None:
    archive = presetzip.restore_zip_with_working(_zip({"hqplayerd.xml": b"<old/>"}), b"<new/>")
    assert _member(archive, "hqplayerd.xml") == b"<new/>"


def test_restore_zip_writes_the_mirror_snapshot() -> None:
    archive = presetzip.restore_zip_with_working(_zip({"hqplayerd.xml": b"<x/>"}), b"<new/>", mirror_name="Speakers")
    assert _member(archive, "data/cfgs/Speakers.xml") == b"<new/>"


def test_restore_zip_writes_a_non_ascii_mirror_snapshot_under_that_name() -> None:
    # A preset name is a zip member name too (docs/protocol.md:91). Nothing in
    # HQPlayer's docs constrains its charset, and an em dash round-trips through
    # the live daemon, so the member must carry the name intact.
    archive = presetzip.restore_zip_with_working(
        _zip({"hqplayerd.xml": b"<x/>"}), b"<new/>", mirror_name=DASHED_NAME
    )
    assert _member(archive, f"data/cfgs/{DASHED_NAME}.xml") == b"<new/>"


def test_restore_zip_inserts_hqplayerd_when_a_named_profile_was_active() -> None:
    # named profile active -> root <Name>.xml, no hqplayerd.xml; restore lands on
    # [default], so hqplayerd.xml must be inserted for it to have a config to run
    archive = presetzip.restore_zip_with_working(_zip({"Speakers.xml": b"<root/>"}), b"<new/>")
    assert _member(archive, "hqplayerd.xml") == b"<new/>"


def test_snapshot_members_extracts_preset_names() -> None:
    zip_bytes = _zip({"hqplayerd.xml": b"<x/>", "data/cfgs/A.xml": b"<a/>", "data/cfgs/B.xml": b"<b/>"})
    assert set(presetzip.snapshot_members(zip_bytes)) == {"A", "B"}


# --- manager preset lifecycle against the fake daemon ----------------------


def _pmgr(daemon: dict[str, Any], tmp_path: Path) -> tuple[ConnectionManager, HttpConfigClient]:
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    cfg = Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    return ConnectionManager(cfg, http), http


async def test_saved_preset_is_listed_and_marked_active(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.presetops.save_preset("Studio")
        presets = manager.presetops.presets()
    finally:
        await http.aclose()
    assert presets["active"] == "Studio"


async def test_load_preset_restores_its_saved_config(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    # save captures the running config, a later edit drifts it, and loading the
    # preset restores it — proving load drives the daemon back to the saved state
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.presetops.save_preset("Base")
        await manager.applyops.apply({}, {"title": "Drift"})
        await manager.presetops.load_preset("Base")
        title = {f["name"]: f["value"] for f in (await http.get_config())["fields"]}["title"]
    finally:
        await http.aclose()
    assert title == "Opal"


async def test_delete_preset_removes_it_from_the_list(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await manager.presetops.save_preset("Temp")
        await manager.presetops.delete_preset("Temp")
        names = [o["value"] for o in manager.presetops.presets()["options"]]
    finally:
        await http.aclose()
    assert "Temp" not in names


# --- the daemon mirror: a save is the STORE write, not the mirror -------------
#
# The mirror (``data/cfgs/<name>.xml``) only feeds hqplayerd's own profile list.
# It rides a POST /restore that routinely lands while the daemon is still
# restarting from the apply the save follows, so it retries — and when it finally
# does not land, the save is still a save. Reporting it as failed is what sent a
# user hunting for a preset that was already on disk.


async def test_a_save_whose_mirror_never_lands_still_reports_ok(
    restore_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    manager = http_manager_factory(restore_refusing_http_daemon, alarm_threshold=3.0)
    result = await manager.presetops.save_preset("Studio")
    assert result["ok"] is True


async def test_a_save_whose_mirror_never_lands_warns(
    restore_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the warning's wording is owner-owned data (docs/testing.md rule 9); the key
    # being present at all is the signal the card renders on
    manager = http_manager_factory(restore_refusing_http_daemon, alarm_threshold=3.0)
    result = await manager.presetops.save_preset("Studio")
    assert "warning" in result


async def test_a_save_whose_mirror_never_lands_still_stores_the_preset(
    restore_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    manager = http_manager_factory(restore_refusing_http_daemon, alarm_threshold=3.0)
    await manager.presetops.save_preset("Studio")
    assert "Studio" in [o["value"] for o in manager.presetops.presets()["options"]]


async def test_a_save_whose_mirror_never_lands_still_marks_it_active(
    restore_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the active pointer moved with the store write, not with the daemon: a save
    # that reached disk is the active preset even when the mirror is behind
    manager = http_manager_factory(restore_refusing_http_daemon, alarm_threshold=3.0)
    await manager.presetops.save_preset("Studio")
    assert manager.presetops.presets()["active"] == "Studio"


async def test_a_mirror_retries_rather_than_giving_up_on_one_refusal(
    restore_recovering_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # two refusals then an accept: a single-shot POST would report a warning the
    # next second would not have seen
    manager = http_manager_factory(restore_recovering_http_daemon, alarm_threshold=3.0)
    result = await manager.presetops.save_preset("Studio")
    assert "warning" not in result


async def test_a_mirror_stops_retrying_at_the_deadline(
    restore_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # three passes fit a 3 s deadline at a 1 s interval, then the loop concludes —
    # the retry is bounded, not an unbounded hammer on a daemon that is gone
    manager = http_manager_factory(restore_refusing_http_daemon, alarm_threshold=3.0)
    await manager.presetops.save_preset("Studio")
    assert restore_refusing_http_daemon["_restore_attempts"] == 3


async def test_a_healthy_save_reports_no_warning(http_manager: ConnectionManager) -> None:
    result = await http_manager.presetops.save_preset("Studio")
    assert "warning" not in result


async def test_a_healthy_save_carries_the_mirror_to_the_daemon(
    http_daemon: dict[str, Any],
    http_manager: ConnectionManager,
) -> None:
    await http_manager.presetops.save_preset("Studio")
    assert "data/cfgs/Studio.xml" in http_daemon["_restore_members"]
