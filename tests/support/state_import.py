"""The install, the archive source and the upload the `POST /api/state-import` suites share.

An install is a store tree under one root: every JSON store and the preset
store under ``root/state``, backups under ``root/backups``. A source is a second
such tree an archive is exported from with this build's own `state_archive`.
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from httpx import Response

from hqptuner.config import Config
from hqptuner.presets.store.export import state_archive
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.presets import PresetStore

ROUTE = "/api/state-import"
FIELD = "statefile"
UPLOAD_NAME = "hqptuner-state-from-the-den.zip"

#: Each single-file store this build imports: its `Config` field and its name in the archive.
FILE_STORES = [
    ("live_preset_file", "live-presets.json"),
    ("favorites_file", "favorites.json"),
    ("narrowing_file", "narrowing.json"),
    ("description_file", "descriptions.json"),
    ("matrix_mode_file", "matrixmodes.json"),
    ("autopilot_file", "autopilot.json"),
]
PRESETS = "presets"

#: The JSON stores seeded with an empty object, the ones whose layout no case reads.
PLAIN_STORES = ["narrowing.json", "descriptions.json", "matrixmodes.json", "autopilot.json"]

INSTALL_FAVORITE = "install-favorite"
ARCHIVE_FAVORITE = "archive-favorite"
SECOND_FAVORITE = "second-import-favorite"
ARCHIVE_LOG_LINE = "archive-log-line-5c21"
DEBUG_LOG_NAME = "engine-debug.txt"

PRESET_XML = b"<hqplayerd/>"
RECORD = LiveRecord(chain="pcm", fields={"filter": "12"}, names={"filter": "poly-sinc-gauss-long"})

PRE_IMPORT_BACKUP = "pre-import-state.zip"


def favorites(filter_name: str) -> bytes:
    return json.dumps({"schema": 1, "filters": [filter_name]}).encode()


def zip_of(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def store_config(root: Path, debug_log: Path | None = None) -> Config:
    """A `Config` with every store under ``root/state`` and backups under ``root/backups``."""
    cfg = Config(debug_log=debug_log)
    cfg.connection_file = root / "state" / "connection.json"
    for attr, name in FILE_STORES:
        setattr(cfg, attr, root / "state" / name)
    cfg.preset_dir = root / "state" / PRESETS
    cfg.backup_dir = root / "backups"
    return cfg


def seed_install(root: Path) -> Path:
    """A favorite, a config preset ``Den`` that is the active one, a live snapshot
    ``alpha`` held by the default station and by ``Den``, an empty object in each
    remaining JSON store, and an empty backups directory."""
    write(root / "state" / "favorites.json", favorites(INSTALL_FAVORITE))
    for name in PLAIN_STORES:
        write(root / "state" / name, b"{}")
    presets = PresetStore(root / "state" / PRESETS)
    presets.save("Den", PRESET_XML)
    presets.set_active("Den")
    LivePresetStore(root / "state" / "live-presets.json", stations=lambda: ["Den"]).save("alpha", RECORD, ["", "Den"])
    (root / "backups").mkdir(parents=True)
    return root


def install_app_config(http_daemon: dict[str, Any], install: Path, control_port: int, audit_log: Path) -> Config:
    """The app's `Config` over the install: its stores, the fake 8088 daemon, the given control port."""
    stores = store_config(install)
    return Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=stores.backup_dir,
        preset_dir=stores.preset_dir,
        connection_file=stores.connection_file,
        live_preset_file=stores.live_preset_file,
        favorites_file=stores.favorites_file,
        narrowing_file=stores.narrowing_file,
        description_file=stores.description_file,
        matrix_mode_file=stores.matrix_mode_file,
        autopilot_file=stores.autopilot_file,
        advisor_enabled=True,
        hqp_home="/x/home",
        debug_log=audit_log,
    )


def source_debug_log(tmp_path: Path) -> Path:
    return tmp_path / "source" / "logs" / DEBUG_LOG_NAME


def source(tmp_path: Path) -> Config:
    """The stores of the install an archive is exported from, all absent until a case writes one."""
    return store_config(tmp_path / "source", debug_log=source_debug_log(tmp_path))


def export(cfg: Config) -> bytes:
    return state_archive(cfg, [ARCHIVE_LOG_LINE])


def archive_with_favorites(tmp_path: Path, filter_name: str) -> bytes:
    cfg = source(tmp_path)
    write(cfg.favorites_file, favorites(filter_name))
    return export(cfg)


def upload(client: TestClient, archive: bytes, filename: str = UPLOAD_NAME) -> Response:
    response: Response = client.post(ROUTE, files={FIELD: (filename, archive, "application/zip")})
    return response


def installed_favorites(install: Path) -> list[str]:
    return list(json.loads((install / "state" / "favorites.json").read_bytes()).get("filters", []))


def store_fingerprints(install: Path) -> dict[str, object]:
    """Each store's content as it stands on disk: a file's bytes, or the preset
    store's names with their payloads; None for a file that is gone."""
    state = install / "state"
    found: dict[str, object] = {}
    for _, name in FILE_STORES:
        path = state / name
        found[name] = path.read_bytes() if path.exists() else None
    presets = PresetStore(state / PRESETS)
    found[PRESETS] = tuple((name, presets.read(name)) for name in presets.names())
    return found


def changed_stores(before: dict[str, object], after: dict[str, object]) -> set[str]:
    return {name for name in before if before[name] != after[name]}


def loaded_station(client: TestClient) -> object:
    return client.get("/api/livepresets").json().get("station")


def zip_json_member(archive: Path, name: str) -> object:
    """One member of a zip on disk, parsed; None when the zip or the member is absent."""
    if not archive.is_file() or not zipfile.is_zipfile(archive):
        return None
    with zipfile.ZipFile(archive) as opened:
        if name not in opened.namelist():
            return None
        return json.loads(opened.read(name))
