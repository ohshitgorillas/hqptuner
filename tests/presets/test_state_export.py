"""The state archive a user downloads and attaches to a bug report.

`state_archive` zips HQPTuner's own state: every store file and store directory
the install keeps, the debug log and its rolled sibling, and the in-memory log
lines it is handed. Every case builds real files under ``tmp_path`` and a
`Config` whose store fields point there, then reads the returned bytes back as
a zip.
"""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.presets.store.export import state_archive

#: Each single-file store: its `Config` field and the name it is archived under.
FILE_STORES = [
    ("connection_file", "connection.json"),
    ("live_preset_file", "live-presets.json"),
    ("favorites_file", "favorites.json"),
    ("narrowing_file", "narrowing.json"),
    ("description_file", "descriptions.json"),
    ("matrix_mode_file", "matrixmodes.json"),
    ("autopilot_file", "autopilot.json"),
]

#: Each directory store: its `Config` field and the name it is archived under.
DIR_STORES = [("backup_dir", "backups"), ("preset_dir", "presets")]

#: Every store name, the top-level member names a store can occupy.
STORE_NAMES = {name for _, name in FILE_STORES + DIR_STORES}

#: A connection record as one install saved it, password included.
SAVED_HOST = "10.0.0.5"
CONNECTION_RECORD = {"host": SAVED_HOST, "username": "u", "password": "s3cret", "remember": True}

#: The debug log's own name, deliberately unlike any store or `hqptuner.log`.
DEBUG_LOG_NAME = "engine-debug.txt"

#: In-memory log lines handed to the export.
LOG_LINES = ["first line of the log", "second line of the log", "third line"]


def config_at(state: Path, debug_log: Path | None = None) -> Config:
    """A `Config` with every store under ``state``, named as the store is named."""
    cfg = Config(debug_log=debug_log)
    for attr, name in FILE_STORES + DIR_STORES:
        setattr(cfg, attr, state / name)
    return cfg


def members(archive: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def json_member(archive: bytes, name: str) -> dict[str, Any]:
    """The member parsed as a JSON object, or an empty dict when it is absent."""
    raw = members(archive).get(name)
    return {} if raw is None else dict(json.loads(raw))


def store_member_names(archive: bytes) -> set[str]:
    """Member names that sit under a store name, at top level or inside a store directory."""
    return {name for name in members(archive) if name.split("/")[0] in STORE_NAMES}


def write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


@pytest.mark.parametrize(("attr", "name"), FILE_STORES)
def test_an_existing_store_file_is_archived_under_its_store_name(tmp_path: Path, attr: str, name: str) -> None:
    cfg = config_at(tmp_path / "state")
    write(getattr(cfg, attr), json.dumps({"store": name}).encode())
    assert json_member(state_archive(cfg, []), name).get("store") == name


@pytest.mark.parametrize(
    ("attr", "relative", "member"),
    [
        ("backup_dir", "pre-apply-settings.zip", "backups/pre-apply-settings.zip"),
        ("preset_dir", "store.json", "presets/store.json"),
        ("preset_dir", "nested/deeper.json", "presets/nested/deeper.json"),
    ],
)
def test_a_file_inside_a_store_directory_is_archived_under_its_path_relative_to_that_store(
    tmp_path: Path, attr: str, relative: str, member: str
) -> None:
    cfg = config_at(tmp_path / "state")
    content = f"content of {member}".encode()
    write(getattr(cfg, attr) / relative, content)
    assert members(state_archive(cfg, [])).get(member) == content


def test_the_archived_connection_record_survives_with_its_password_blanked(tmp_path: Path) -> None:
    cfg = config_at(tmp_path / "state")
    write(cfg.connection_file, json.dumps(CONNECTION_RECORD).encode())
    assert json_member(state_archive(cfg, []), "connection.json") == {**CONNECTION_RECORD, "password": ""}


def test_parked_filter_uploads_are_left_out_of_the_backups(tmp_path: Path) -> None:
    cfg = config_at(tmp_path / "state")
    write(cfg.backup_dir / "pre-apply-settings.zip", b"backup")
    write(cfg.backup_dir / "pending-filters" / "my-room.wav", b"RIFF")
    write(cfg.backup_dir / "pending-filters" / "parked" / "left.wav", b"RIFF")
    backups = {name for name in members(state_archive(cfg, [])) if name.startswith("backups/")}
    assert backups == {"backups/pre-apply-settings.zip"}


@pytest.mark.parametrize("filename", [DEBUG_LOG_NAME, f"{DEBUG_LOG_NAME}.1"])
def test_the_debug_log_and_its_rolled_sibling_are_archived_under_their_basenames(tmp_path: Path, filename: str) -> None:
    log_dir = tmp_path / "logs" / "debug"
    cfg = config_at(tmp_path / "state", debug_log=log_dir / DEBUG_LOG_NAME)
    write(log_dir / DEBUG_LOG_NAME, b"current log")
    write(log_dir / f"{DEBUG_LOG_NAME}.1", b"rolled log")
    expected = (log_dir / filename).read_bytes()
    assert members(state_archive(cfg, [])).get(filename) == expected


def test_the_log_lines_are_archived_one_per_line_as_hqptuner_log(tmp_path: Path) -> None:
    cfg = config_at(tmp_path / "state")
    archived = members(state_archive(cfg, LOG_LINES)).get("hqptuner.log", b"")
    assert archived.decode().splitlines() == LOG_LINES


def test_stores_missing_from_disk_are_absent_from_the_archive(tmp_path: Path) -> None:
    cfg = config_at(tmp_path / "state")
    write(cfg.favorites_file, b'{"filters": []}')
    assert store_member_names(state_archive(cfg, [])) == {"favorites.json"}
