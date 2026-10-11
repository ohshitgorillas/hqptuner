"""HQPTuner-owned preset lifecycle.

Two layers: the pure ``presetzip`` archive helpers (bytes in, bytes out), and
the manager's save/load/list/delete through the faithful fake config daemon —
the same wire contract the apply tests use, so a preset only round-trips if the
restore archive is one the real daemon would accept."""

import io
import zipfile
from pathlib import Path
from typing import Any

from virtual_clock import VirtualClock

from hqptuner.conf import presetconf, presetzip
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

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
    # A preset name is a zip member name too. Nothing in
    # HQPlayer's docs constrains its charset, and an em dash round-trips through
    # the live daemon, so the member must carry the name intact.
    archive = presetzip.restore_zip_with_working(_zip({"hqplayerd.xml": b"<x/>"}), b"<new/>", mirror_name=DASHED_NAME)
    assert _member(archive, f"data/cfgs/{DASHED_NAME}.xml") == b"<new/>"


def test_restore_zip_inserts_hqplayerd_when_a_named_profile_was_active() -> None:
    # named profile active -> root <Name>.xml, no hqplayerd.xml; restore lands on
    # [default], so hqplayerd.xml must be inserted for it to have a config to run
    archive = presetzip.restore_zip_with_working(_zip({"Speakers.xml": b"<root/>"}), b"<new/>")
    assert _member(archive, "hqplayerd.xml") == b"<new/>"


#: The working config of a named profile, as a /backup archive carries it both
#: at the root and under data/cfgs.
NAMED_WORKING_XML = b'<hqplayerd><engine fft_size="4096"/></hqplayerd>'
STAGED_FFT_SIZE = "8192"


def _field_in_member(zip_bytes: bytes, name: str, field: str) -> str | None:
    archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    if name not in archive.namelist():
        return None
    return presetconf.read_config(archive.read(name)).get(field)


def test_restore_from_running_carries_the_edit_in_hqplayerd_when_a_named_profile_was_active() -> None:
    # restore boots [default] from hqplayerd.xml and discards an edit to the
    # root-renamed <Profile>.xml, so the edit must land there
    backup = _zip({"Speakers.xml": NAMED_WORKING_XML, "data/cfgs/Speakers.xml": NAMED_WORKING_XML})
    archive, _intended = presetzip.restore_zip_from_running(
        backup, {"fft_size": STAGED_FFT_SIZE}, presetzip.ApplyContext(active="Speakers")
    )
    assert _field_in_member(archive, "hqplayerd.xml", "fft_size") == STAGED_FFT_SIZE


def test_snapshot_members_extracts_preset_names() -> None:
    zip_bytes = _zip({"hqplayerd.xml": b"<x/>", "data/cfgs/A.xml": b"<a/>", "data/cfgs/B.xml": b"<b/>"})
    assert set(presetzip.snapshot_members(zip_bytes)) == {"A", "B"}


# --- manager preset lifecycle against the fake daemon ----------------------


def _pmgr(daemon: dict[str, Any], tmp_path: Path) -> tuple[ConnectionManager, HttpConfigClient]:
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    cfg = Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    return ConnectionManager(cfg, http, VirtualClock()), http


async def test_load_preset_restores_its_saved_config(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    # save captures the running config, a later edit drifts it, and loading the
    # preset restores it — proving load drives the daemon back to the saved state
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await presetlane.save(manager, "Base")
        await manager.applyops.apply({}, {"title": "Drift"})
        await presetlane.load(manager, "Base")
        title = {f["name"]: f["value"] for f in (await http.get_config())["fields"]}["title"]
    finally:
        await http.aclose()
    assert title == "Opal"


async def test_delete_preset_removes_it_from_the_list(http_daemon: dict[str, Any], tmp_path: Path) -> None:
    manager, http = _pmgr(http_daemon, tmp_path)
    try:
        await presetlane.save(manager, "Temp")
        await presetlane.delete(manager, "Temp")
        names = [o.value for o in presetlane.listing(manager).options]
    finally:
        await http.aclose()
    assert "Temp" not in names
