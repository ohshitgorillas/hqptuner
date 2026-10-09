"""`POST /api/state-import` refusing what it cannot take whole (docs/architecture.md §5.7):
a preset store carrying a file that is not a preset, a pre-import backup that
cannot be written, and an autosave already in flight when the import lands.

The install and the archives are `state_import`'s: ``Den`` is the loaded
station, and an archive is this build's own export or a hand-written zip. The
http lane is the fake 8088 daemon; the control lane is a closed port, except
for the autosave cases, which need a live write to land on the threaded fake
4321 daemon so its autosave reads the 8088 daemon's backup.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from apps import wait_for_api
from fastapi.testclient import TestClient
from httpx import Response
from state_import import (
    ARCHIVE_FAVORITE,
    PRESET_XML,
    PRESETS,
    SECOND_FAVORITE,
    archive_with_favorites,
    changed_stores,
    export,
    favorites,
    install_app_config,
    installed_favorites,
    loaded_station,
    seed_install,
    source,
    store_fingerprints,
    upload,
    write,
    zip_of,
)
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.presets.store.presets import PresetStore

#: The install's loaded station as an archive carries it, unlike anything the fake daemon serves.
ARCHIVE_DEN_XML = b'<hqplayerd><marker value="imported-den-6b2c"/></hqplayerd>'

#: A preset name in mixed scripts, a Cyrillic letter ahead of Latin ones: a first save
#: refuses it, but the store holds one already there, as an import copies it.
MIXED_SCRIPT = chr(0x0430) + "dmin"

#: Members of an archive's preset store that are not a preset this build can hold.
STRAY_PRESET_MEMBERS = [
    pytest.param({"presets/.hidden.xml": PRESET_XML}, id="name-with-a-leading-dot"),
    pytest.param({"presets/Office.txt": PRESET_XML}, id="not-xml"),
    pytest.param({"presets/nested/Office.xml": PRESET_XML}, id="in-a-subdirectory"),
]


@pytest.fixture
def install(tmp_path: Path) -> Path:
    return seed_install(tmp_path / "install")


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def client(http_daemon: dict[str, Any], install: Path, closed_port: int, audit_log: Path) -> Iterator[TestClient]:
    cfg = install_app_config(http_daemon, install, closed_port, audit_log)
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        yield test_client


@pytest.fixture
def answering_client(
    http_daemon: dict[str, Any], install: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    """`client` that hands back the app's answer to an unhandled error, as a browser sees it, rather than raising it."""
    cfg = install_app_config(http_daemon, install, closed_port, audit_log)
    with TestClient(create_app(cfg, VirtualClock()), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def dual_lane_client(
    http_daemon: dict[str, Any], install: Path, threaded_daemon_port: int, audit_log: Path
) -> Iterator[TestClient]:
    """`client` with the control lane on the threaded fake 4321 daemon, so a live write lands and autosaves."""
    cfg = install_app_config(http_daemon, install, threaded_daemon_port, audit_log)
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        wait_for_api(test_client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        yield test_client


# --- a preset store carrying what is not a preset ------------------------------


def with_stray_preset_member(stray: dict[str, bytes]) -> bytes:
    """A favorites store and a preset store holding ``Office`` beside one stray member."""
    return zip_of({"favorites.json": favorites(SECOND_FAVORITE), "presets/Office.xml": PRESET_XML, **stray})


@pytest.mark.parametrize("stray", STRAY_PRESET_MEMBERS)
def test_a_preset_store_carrying_a_file_that_is_not_a_preset_is_refused_as_unreadable(
    client: TestClient, stray: dict[str, bytes]
) -> None:
    assert upload(client, with_stray_preset_member(stray)).json().get("code") == "state_unreadable"


@pytest.mark.parametrize("stray", STRAY_PRESET_MEMBERS)
def test_a_preset_store_carrying_a_file_that_is_not_a_preset_leaves_every_store_as_the_last_import_left_it(
    client: TestClient, install: Path, tmp_path: Path, stray: dict[str, bytes]
) -> None:
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    upload(client, with_stray_preset_member(stray))
    assert installed_favorites(install) == [ARCHIVE_FAVORITE]


@pytest.mark.parametrize("stray", STRAY_PRESET_MEMBERS)
def test_a_preset_store_carrying_a_file_that_is_not_a_preset_leaves_the_installs_presets(
    client: TestClient, install: Path, tmp_path: Path, stray: dict[str, bytes]
) -> None:
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    upload(client, with_stray_preset_member(stray))
    assert PresetStore(install / "state" / PRESETS).names() == ["Den"]


def test_a_preset_whose_name_mixes_scripts_is_imported(client: TestClient, install: Path) -> None:
    upload(client, zip_of({f"presets/{MIXED_SCRIPT}.xml": PRESET_XML}))
    assert PresetStore(install / "state" / PRESETS).names() == [MIXED_SCRIPT]


# --- a pre-import backup that cannot be written --------------------------------


def block_the_backup_dir(install: Path) -> None:
    """Put a plain file where the install's backups directory stands, so nothing can be written under it."""
    (install / "backups").rmdir()
    write(install / "backups", b"not a directory")


def unblock_the_backup_dir(install: Path) -> None:
    """Put back the empty backups directory `block_the_backup_dir` displaced."""
    (install / "backups").unlink()
    (install / "backups").mkdir()


def refusal_code(response: Response) -> object:
    """The answer's ``code``; None for an answer that is not JSON, such as an unhandled error's."""
    if not response.headers.get("content-type", "").startswith("application/json"):
        return None
    return response.json().get("code")


def test_an_import_whose_pre_import_backup_cannot_be_written_is_refused_as_backup_failed(
    answering_client: TestClient, install: Path, tmp_path: Path
) -> None:
    archive = archive_with_favorites(tmp_path, ARCHIVE_FAVORITE)
    block_the_backup_dir(install)
    assert refusal_code(upload(answering_client, archive)) == "backup_failed"


def test_an_import_whose_pre_import_backup_cannot_be_written_changes_no_store(
    answering_client: TestClient, install: Path, tmp_path: Path
) -> None:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    PresetStore(cfg.preset_dir).save("Office", PRESET_XML)
    archive = export(cfg)
    before = store_fingerprints(install)
    block_the_backup_dir(install)
    upload(answering_client, archive)
    refused = store_fingerprints(install)
    unblock_the_backup_dir(install)
    upload(answering_client, archive)
    landed = store_fingerprints(install)
    assert [changed_stores(before, refused), changed_stores(refused, landed)] == [set(), {"favorites.json", PRESETS}]


def test_an_import_whose_pre_import_backup_cannot_be_written_leaves_the_loaded_station(
    answering_client: TestClient, install: Path, tmp_path: Path
) -> None:
    archive = archive_with_favorites(tmp_path, ARCHIVE_FAVORITE)
    block_the_backup_dir(install)
    upload(answering_client, archive)
    assert loaded_station(answering_client) == "Den"


# --- an import landing inside an autosave's wait on the daemon -----------------


def import_inside_the_autosave(client: TestClient, http_daemon: dict[str, Any], tmp_path: Path) -> list[int]:
    """With autosave on and ``Den`` loaded, make a live write whose autosave reads the
    daemon's backup; while that read waits, import an archive replacing ``Den``.
    Returns the status of each import that ran: one, unless the autosave never read."""
    cfg = source(tmp_path)
    PresetStore(cfg.preset_dir).save("Den", ARCHIVE_DEN_XML)
    archive = export(cfg)
    statuses: list[int] = []
    client.post("/api/autosave", json={"enabled": True})
    http_daemon["_on_backup"] = lambda: statuses.append(upload(client, archive).status_code)
    client.post("/api/config/live", json={"fields": {"filter": "25"}})
    return statuses


def test_an_autosave_in_flight_does_not_overwrite_the_presets_an_import_landed(
    dual_lane_client: TestClient, install: Path, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    import_inside_the_autosave(dual_lane_client, http_daemon, tmp_path)
    assert PresetStore(install / "state" / PRESETS).read("Den") == ARCHIVE_DEN_XML


def test_an_import_landing_while_an_autosave_is_in_flight_is_not_refused(
    dual_lane_client: TestClient, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    statuses = import_inside_the_autosave(dual_lane_client, http_daemon, tmp_path)
    assert [status // 100 for status in statuses] == [2]
