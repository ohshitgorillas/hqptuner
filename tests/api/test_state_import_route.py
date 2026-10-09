"""`POST /api/state-import`: a state zip taken back into this install (docs/architecture.md §5.7).

Every case runs the REST app over an install whose stores sit under
``tmp_path / "install"``, seeded before the app starts: a favorite, a config
preset ``Den`` that is the active one, a live snapshot ``alpha`` held by the
default station and by ``Den``, and an empty object in each remaining JSON
store. The archives uploaded are built the two ways a user comes by one: this
build's own export (`state_archive`) over a second set of stores under
``tmp_path / "source"``, and a hand-written zip for a file v1 wrote or a file
that cannot be imported. The http lane is the fake 8088 daemon and the control
lane a closed port, so any daemon contact fails.
"""

import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from audit_records import records
from fastapi.testclient import TestClient
from httpx import Response
from state_import import (
    ARCHIVE_FAVORITE,
    ARCHIVE_LOG_LINE,
    DEBUG_LOG_NAME,
    FILE_STORES,
    INSTALL_FAVORITE,
    PRE_IMPORT_BACKUP,
    PRESET_XML,
    PRESETS,
    RECORD,
    SECOND_FAVORITE,
    UPLOAD_NAME,
    archive_with_favorites,
    changed_stores,
    export,
    favorites,
    install_app_config,
    installed_favorites,
    loaded_station,
    seed_install,
    source,
    source_debug_log,
    store_fingerprints,
    upload,
    write,
    zip_json_member,
    zip_of,
)
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.presets import PresetStore

#: Every store name an answer can name, so a name is recognised whatever its spelling.
STORE_NAMES = {name for _, name in FILE_STORES} | {PRESETS}

#: The station loaded in the install an archive is exported from, a name the install does not hold.
ARCHIVE_STATION = "Office"
#: The station `seed_install` leaves loaded.
INSTALL_STATION = "Den"
#: The station the live book names when none is loaded.
NO_STATION = ""
ARCHIVE_HOST = "203.0.113.77"
INSTALL_HOST = "198.51.100.23"
INSTALL_BACKUP = b"install-backup-bytes-3a61"
INSTALL_LOG_LINE = b'{"marker": "install-log-line-e842"}\n'
ARCHIVE_BACKUP = b"archive-backup-bytes-7f3e"
ARCHIVE_DEBUG_LOG = b"archive-debug-log-9d04"

#: A live snapshot as v1 stored it: the flat schema-3 layout, junk filter and auto-pilot beside the settings.
V1_LIVE_PRESETS = {
    "schema": 3,
    "presets": {
        "vintage": {
            "chain": "pcm",
            "fields": {"filter": "12", "junk_filter": "1"},
            "names": {"filter": "poly-sinc-gauss-long", "junk_filter": "20k"},
            "autopilot": True,
        }
    },
}

#: A schema stamp no build of HQPTuner has written.
TOO_NEW = 9999


#: The state limit the capped client is built with, in bytes; small so an archive
#: past it is a few KiB rather than the 64 MiB default.
STATE_LIMIT = 4096

#: The narrowing store with an empty pad, the frame `unpacking_to` fills.
EMPTY_PAD = b'{"pad": ""}'


def second_favorites_with_comment(comment: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.comment = comment
        archive.writestr("favorites.json", favorites(SECOND_FAVORITE))
    return buffer.getvalue()


def uploaded_size(size: int) -> bytes:
    """A valid archive carrying SECOND_FAVORITE whose upload is ``size`` bytes, padded
    by the zip comment, so its one store unpacks to a few dozen bytes whatever the size."""
    unpadded = len(second_favorites_with_comment(b""))
    return second_favorites_with_comment(b"c" * (size - unpadded))


def unpacking_to(size: int) -> bytes:
    """A valid deflated archive whose two stores, favorites carrying SECOND_FAVORITE and a
    padded narrowing store, unpack to ``size`` bytes together and each to less, uploaded small."""
    carried = favorites(SECOND_FAVORITE)
    pad = b"a" * (size - len(carried) - len(EMPTY_PAD))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("favorites.json", carried)
        archive.writestr("narrowing.json", b'{"pad": "' + pad + b'"}')
    return buffer.getvalue()


#: The two sizes the state limit bounds, each as the archive that reaches a given size by it alone.
STATE_SIZES = [pytest.param(uploaded_size, id="upload"), pytest.param(unpacking_to, id="unpacked-stores")]


#: The defect each archive refused as unreadable carries beside a valid favorites store.
UNREADABLE_DEFECTS: dict[str, dict[str, bytes]] = {
    "store-is-a-json-array": {"narrowing.json": b"[1, 2]"},
    "store-is-a-json-string": {"narrowing.json": b'"a string"'},
    "store-is-not-json": {"narrowing.json": b"{not json"},
    "member-climbs-out-of-the-presets-store": {"presets/../narrowing.json": b"{}"},
    "member-climbs-out-of-the-install": {"presets/nested/../../../escaped.xml": PRESET_XML},
}
UNREADABLE_WITH_A_VALID_STORE = [pytest.param(defect, id=name) for name, defect in UNREADABLE_DEFECTS.items()]

#: Archives with a store stamped newer than this build understands.
TOO_NEW_MEMBERS = [
    pytest.param({"favorites.json": json.dumps({"schema": TOO_NEW, "filters": []}).encode()}, id="favorites"),
    pytest.param({"live-presets.json": json.dumps({"schema": TOO_NEW, "stations": {}}).encode()}, id="live-presets"),
    pytest.param({"presets/store.json": json.dumps({"schema": TOO_NEW}).encode()}, id="presets"),
]

#: Every refused archive whose refusal must come before anything is written.
REFUSED_WITH_A_VALID_STORE = [
    *UNREADABLE_WITH_A_VALID_STORE,
    pytest.param({"narrowing.json": json.dumps({"schema": TOO_NEW}).encode()}, id="store-too-new"),
]


# --- the install, the source of an archive, and the app over the install ------


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
def capped_client(
    http_daemon: dict[str, Any], install: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    """`client` with the state limit pinned to STATE_LIMIT."""
    cfg = install_app_config(http_daemon, install, closed_port, audit_log)
    cfg.state_max_bytes = STATE_LIMIT
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        yield test_client


# --- reading the install back --------------------------------------------------


def files_holding(root: Path, markers: list[bytes]) -> set[str]:
    """Paths under ``root``, relative to it, of every file whose bytes carry any of the markers."""
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and any(marker in path.read_bytes() for marker in markers)
    }


def book(client: TestClient) -> dict[str, Any]:
    answered: dict[str, Any] = client.get("/api/livepresets").json().get("stations", {})
    return answered


def held(client: TestClient, station: str) -> list[str]:
    """The snapshot names one station holds; a station the book lacks reads as ``["?"]``, never as empty."""
    return sorted(book(client).get(station, {"?": None}))


def strings_in(value: object) -> set[str]:
    """Every string anywhere in a parsed JSON value, keys included."""
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return {s for key, item in value.items() for s in strings_in(key) | strings_in(item)}
    if isinstance(value, list):
        return {s for item in value for s in strings_in(item)}
    return set()


def store_named(text: str) -> str | None:
    """The store a string names, spelled with or without its ``.json`` or trailing slash."""
    bare = text.rstrip("/")
    for candidate in (bare, f"{bare}.json"):
        if candidate in STORE_NAMES:
            return candidate
    return None


def stores_named_in(response: Response) -> set[str]:
    return {name for text in strings_in(response.json()) if (name := store_named(text)) is not None}


def audit_values(audit_log: Path, digest: str) -> set[object]:
    """Every scalar in the audit record that carries ``digest``, at any depth; empty when none does."""

    def scalars(value: object) -> set[object]:
        if isinstance(value, dict):
            return {s for item in value.values() for s in scalars(item)}
        if isinstance(value, list):
            return {s for item in value for s in scalars(item)}
        return {value}

    for record in records(audit_log):
        found = scalars(record)
        if digest in found:
            return found
    return set()


# --- each recognised store replaces this install's copy -----------------------


def test_an_imported_favorites_store_replaces_the_installs_favorites(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    upload(client, export(cfg))
    assert installed_favorites(install) == [ARCHIVE_FAVORITE]


def test_an_imported_preset_store_replaces_the_installs_presets(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    cfg = source(tmp_path)
    PresetStore(cfg.preset_dir).save("Office", PRESET_XML)
    upload(client, export(cfg))
    assert PresetStore(install / "state" / PRESETS).names() == ["Office"]


@pytest.mark.parametrize(
    ("station", "names"),
    [pytest.param("", ["bravo"], id="station-both-hold"), pytest.param("Den", [], id="station-the-file-lacks")],
)
def test_imported_live_snapshots_replace_the_installs_rather_than_join_them(
    client: TestClient, tmp_path: Path, station: str, names: list[str]
) -> None:
    cfg = source(tmp_path)
    presets = PresetStore(cfg.preset_dir)
    presets.save("Den", PRESET_XML)
    presets.save("Office", PRESET_XML)
    LivePresetStore(cfg.live_preset_file, stations=lambda: ["Den", "Office"]).save("bravo", RECORD, ["", "Office"])
    upload(client, export(cfg))
    assert held(client, station) == names


@pytest.mark.parametrize("carried", [name for _, name in FILE_STORES] + [PRESETS])
def test_an_import_changes_exactly_the_stores_the_file_carries(
    client: TestClient, install: Path, tmp_path: Path, carried: str
) -> None:
    cfg = source(tmp_path)
    if carried == PRESETS:
        PresetStore(cfg.preset_dir).save("Office", PRESET_XML)
    else:
        write(cfg.preset_dir.parent / carried, json.dumps({"carried": carried}).encode())
    before = store_fingerprints(install)
    upload(client, export(cfg))
    assert changed_stores(before, store_fingerprints(install)) == {carried}


# --- what an archive carries that is never imported ---------------------------


def seed_ignored_connection(tmp_path: Path) -> list[bytes]:
    write(source(tmp_path).connection_file, json.dumps({"host": ARCHIVE_HOST, "username": "v"}).encode())
    return [ARCHIVE_HOST.encode()]


def seed_ignored_backups(tmp_path: Path) -> list[bytes]:
    backups = source(tmp_path).backup_dir
    write(backups / "pre-apply-settings.zip", ARCHIVE_BACKUP)
    write(backups / PRE_IMPORT_BACKUP, ARCHIVE_BACKUP)
    return [ARCHIVE_BACKUP]


def seed_ignored_logs(tmp_path: Path) -> list[bytes]:
    debug_log = source_debug_log(tmp_path)
    write(debug_log, ARCHIVE_DEBUG_LOG)
    write(debug_log.with_name(f"{DEBUG_LOG_NAME}.1"), ARCHIVE_DEBUG_LOG)
    return [ARCHIVE_DEBUG_LOG, ARCHIVE_LOG_LINE.encode()]


@pytest.mark.parametrize(
    "seed",
    [
        pytest.param(seed_ignored_connection, id="connection-record"),
        pytest.param(seed_ignored_backups, id="backups"),
        pytest.param(seed_ignored_logs, id="logs"),
    ],
)
def test_only_the_stores_of_an_archive_land_in_the_install(
    client: TestClient, install: Path, tmp_path: Path, seed: Callable[[Path], list[bytes]]
) -> None:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    markers = [ARCHIVE_FAVORITE.encode(), *seed(tmp_path)]
    upload(client, export(cfg))
    assert files_holding(install, markers) == {"state/favorites.json"}


# --- the pre-import backup, the active station, the daemon --------------------


def test_the_installs_state_before_the_import_is_saved_as_the_pre_import_backup(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    upload(client, export(cfg))
    saved = zip_json_member(install / "backups" / PRE_IMPORT_BACKUP, "favorites.json")
    assert saved == json.loads(favorites(INSTALL_FAVORITE))


def zip_members_holding(archive: Path, markers: list[bytes]) -> set[str]:
    """Names of the members of a zip on disk whose unpacked bytes carry any of the
    markers; empty when the zip is absent."""
    if not archive.is_file() or not zipfile.is_zipfile(archive):
        return set()
    with zipfile.ZipFile(archive) as opened:
        return {name for name in opened.namelist() if any(marker in opened.read(name) for marker in markers)}


def seed_install_backups(install: Path) -> list[bytes]:
    for name in (PRE_IMPORT_BACKUP, "pre-apply-settings.zip"):
        write(install / "backups" / name, INSTALL_BACKUP)
    return [INSTALL_BACKUP]


def seed_install_logs(install: Path) -> list[bytes]:
    """Appends to the `audit_log` fixture's file, which sits beside the install."""
    debug_log = install.parent / "audit.jsonl"
    with debug_log.open("ab") as log:
        log.write(INSTALL_LOG_LINE)
    write(debug_log.with_name(f"{debug_log.name}.1"), INSTALL_LOG_LINE)
    return [INSTALL_LOG_LINE]


def seed_install_connection(install: Path) -> list[bytes]:
    write(install / "state" / "connection.json", json.dumps({"host": INSTALL_HOST, "username": "w"}).encode())
    return [INSTALL_HOST.encode()]


@pytest.mark.parametrize(
    "seed",
    [
        pytest.param(seed_install_backups, id="backups"),
        pytest.param(seed_install_logs, id="logs"),
        pytest.param(seed_install_connection, id="connection-record"),
    ],
)
def test_only_the_installs_stores_go_into_the_pre_import_backup(
    client: TestClient, install: Path, tmp_path: Path, seed: Callable[[Path], list[bytes]]
) -> None:
    markers = [INSTALL_FAVORITE.encode(), *seed(install)]
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    assert zip_members_holding(install / "backups" / PRE_IMPORT_BACKUP, markers) == {"favorites.json"}


def import_then_restore(client: TestClient, install: Path, tmp_path: Path) -> None:
    """Import an archive replacing favorites, presets and live snapshots, then import
    the pre-import backup that import saved."""
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    PresetStore(cfg.preset_dir).save(ARCHIVE_STATION, PRESET_XML)
    LivePresetStore(cfg.live_preset_file, stations=lambda: [ARCHIVE_STATION]).save("bravo", RECORD, [""])
    upload(client, export(cfg))
    upload(client, (install / "backups" / PRE_IMPORT_BACKUP).read_bytes(), filename=PRE_IMPORT_BACKUP)


def test_importing_the_pre_import_backup_gives_back_the_favorites_it_saved(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    import_then_restore(client, install, tmp_path)
    assert installed_favorites(install) == [INSTALL_FAVORITE]


def test_importing_the_pre_import_backup_gives_back_the_presets_it_saved(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    import_then_restore(client, install, tmp_path)
    assert PresetStore(install / "state" / PRESETS).names() == ["Den"]


def test_importing_the_pre_import_backup_gives_back_the_live_snapshots_it_saved(
    client: TestClient, install: Path, tmp_path: Path
) -> None:
    import_then_restore(client, install, tmp_path)
    assert held(client, "") == ["alpha"]


def test_no_station_is_loaded_after_an_import(client: TestClient, tmp_path: Path) -> None:
    cfg = source(tmp_path)
    PresetStore(cfg.preset_dir).save(INSTALL_STATION, PRESET_XML)
    before = loaded_station(client)
    upload(client, export(cfg))
    assert [before, loaded_station(client)] == [INSTALL_STATION, NO_STATION]


def test_no_station_is_loaded_after_importing_a_file_that_had_a_station_loaded(
    client: TestClient, tmp_path: Path
) -> None:
    cfg = source(tmp_path)
    presets = PresetStore(cfg.preset_dir)
    presets.save(ARCHIVE_STATION, PRESET_XML)
    presets.set_active(ARCHIVE_STATION)
    before = loaded_station(client)
    upload(client, export(cfg))
    assert [before, loaded_station(client)] == [INSTALL_STATION, NO_STATION]


def test_no_station_is_loaded_after_an_import_that_carries_no_preset_store(client: TestClient, tmp_path: Path) -> None:
    before = loaded_station(client)
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    assert [before, loaded_station(client)] == [INSTALL_STATION, NO_STATION]


def test_v1_live_snapshots_read_back_as_this_builds_snapshots_after_an_import(client: TestClient) -> None:
    upload(client, zip_of({"live-presets.json": json.dumps(V1_LIVE_PRESETS).encode()}))
    assert held(client, "") == ["vintage"]


def test_an_import_lands_while_the_daemon_answers_nothing(
    client: TestClient, install: Path, tmp_path: Path, http_daemon: dict[str, Any]
) -> None:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(ARCHIVE_FAVORITE))
    http_daemon["_down"] = True
    upload(client, export(cfg))
    assert installed_favorites(install) == [ARCHIVE_FAVORITE]


# --- the answer and the audit record ------------------------------------------


@pytest.mark.parametrize(
    "carried",
    [
        pytest.param({"favorites.json"}, id="favorites"),
        pytest.param({"narrowing.json", PRESETS}, id="narrowing-presets"),
    ],
)
def test_the_answer_names_the_stores_the_import_replaced(client: TestClient, tmp_path: Path, carried: set[str]) -> None:
    cfg = source(tmp_path)
    for name in carried:
        if name == PRESETS:
            PresetStore(cfg.preset_dir).save("Office", PRESET_XML)
        else:
            write(cfg.preset_dir.parent / name, b"{}")
    assert stores_named_in(upload(client, export(cfg))) == carried


def test_the_audit_log_records_the_uploads_sha256(client: TestClient, tmp_path: Path, audit_log: Path) -> None:
    archive = archive_with_favorites(tmp_path, ARCHIVE_FAVORITE)
    digest = hashlib.sha256(archive).hexdigest()
    upload(client, archive)
    assert digest in audit_values(audit_log, digest)


def test_the_uploads_audit_record_names_its_file(client: TestClient, tmp_path: Path, audit_log: Path) -> None:
    archive = archive_with_favorites(tmp_path, ARCHIVE_FAVORITE)
    upload(client, archive)
    assert UPLOAD_NAME in audit_values(audit_log, hashlib.sha256(archive).hexdigest())


def test_the_uploads_audit_record_carries_its_size(client: TestClient, tmp_path: Path, audit_log: Path) -> None:
    archive = archive_with_favorites(tmp_path, ARCHIVE_FAVORITE)
    upload(client, archive)
    assert len(archive) in audit_values(audit_log, hashlib.sha256(archive).hexdigest())


# --- refusals -----------------------------------------------------------------


@pytest.mark.parametrize("members", TOO_NEW_MEMBERS)
def test_a_store_stamped_newer_than_this_build_is_refused_as_too_new(
    client: TestClient, members: dict[str, bytes]
) -> None:
    assert upload(client, zip_of(members)).json().get("code") == "state_too_new"


@pytest.mark.parametrize(
    "archive",
    [
        pytest.param(b"this upload is not a zip archive", id="not-a-zip"),
        pytest.param(zip_of({}), id="empty-zip"),
        pytest.param(zip_of({"hqptuner.log": b"a log line\n", "notes.txt": b"notes"}), id="no-recognised-store"),
        *[
            pytest.param(zip_of({"favorites.json": favorites(ARCHIVE_FAVORITE), **defect}), id=name)
            for name, defect in UNREADABLE_DEFECTS.items()
        ],
    ],
)
def test_an_archive_that_cannot_be_imported_is_refused_as_unreadable(client: TestClient, archive: bytes) -> None:
    assert upload(client, archive).json().get("code") == "state_unreadable"


@pytest.mark.parametrize("defect", REFUSED_WITH_A_VALID_STORE)
def test_a_refused_import_leaves_every_store_as_the_last_import_left_it(
    client: TestClient, install: Path, tmp_path: Path, defect: dict[str, bytes]
) -> None:
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    upload(client, zip_of({"favorites.json": favorites(SECOND_FAVORITE), **defect}))
    assert installed_favorites(install) == [ARCHIVE_FAVORITE]


@pytest.mark.parametrize("defect", REFUSED_WITH_A_VALID_STORE)
def test_a_refused_import_leaves_the_pre_import_backup_as_the_last_import_left_it(
    client: TestClient, install: Path, tmp_path: Path, defect: dict[str, bytes]
) -> None:
    upload(client, archive_with_favorites(tmp_path, ARCHIVE_FAVORITE))
    upload(client, zip_of({"favorites.json": favorites(SECOND_FAVORITE), **defect}))
    saved = zip_json_member(install / "backups" / PRE_IMPORT_BACKUP, "favorites.json")
    assert saved == json.loads(favorites(INSTALL_FAVORITE))


# --- the state limit ----------------------------------------------------------


@pytest.mark.parametrize("sized", STATE_SIZES)
def test_an_archive_one_byte_past_the_state_limit_is_refused_as_unreadable(
    capped_client: TestClient, sized: Callable[[int], bytes]
) -> None:
    assert upload(capped_client, sized(STATE_LIMIT + 1)).json().get("code") == "state_unreadable"


@pytest.mark.parametrize("sized", STATE_SIZES)
def test_an_archive_exactly_at_the_state_limit_is_imported(
    capped_client: TestClient, install: Path, sized: Callable[[int], bytes]
) -> None:
    upload(capped_client, sized(STATE_LIMIT))
    assert installed_favorites(install) == [SECOND_FAVORITE]


@pytest.mark.parametrize("sized", STATE_SIZES)
def test_an_archive_past_the_state_limit_leaves_every_store_as_the_last_import_left_it(
    capped_client: TestClient, install: Path, sized: Callable[[int], bytes]
) -> None:
    upload(capped_client, zip_of({"favorites.json": favorites(ARCHIVE_FAVORITE)}))
    upload(capped_client, sized(STATE_LIMIT + 1))
    assert installed_favorites(install) == [ARCHIVE_FAVORITE]


@pytest.mark.parametrize("sized", STATE_SIZES)
def test_an_archive_past_the_state_limit_leaves_the_pre_import_backup_as_the_last_import_left_it(
    capped_client: TestClient, install: Path, sized: Callable[[int], bytes]
) -> None:
    upload(capped_client, zip_of({"favorites.json": favorites(ARCHIVE_FAVORITE)}))
    upload(capped_client, sized(STATE_LIMIT + 1))
    saved = zip_json_member(install / "backups" / PRE_IMPORT_BACKUP, "favorites.json")
    assert saved == json.loads(favorites(INSTALL_FAVORITE))
