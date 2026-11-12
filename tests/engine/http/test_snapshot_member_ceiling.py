"""The first-connect read of the daemon's archive carries the ceilings a restore upload does.

An archive over a ceiling, or one with a member that will not decompress, skips the preset migration and leaves the
connect standing: the store keeps what it had.
"""

import io
import struct
import zipfile
from collections.abc import Iterator
from pathlib import Path

import fake_http
import pytest
from apps import log_in, ready_app
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient

from hqptuner.conf import engineconf, presetzip
from hqptuner.config import Config

_MEMBER = "data/cfgs/x.xml"
_CHUNK = bytes(2**20)


def _archive_with(declared: int | None, *, corrupt: bool = False) -> bytes:
    """A backup with the working config and a ``data/cfgs/x.xml`` member.

    ``declared`` bytes of zeros are streamed into it in chunks, so the decompressed bytes are never held; ``corrupt``
    overwrites its deflate stream instead, the central directory intact.
    """
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("hqplayerd.xml", b"<hqplayerd/>")
        with z.open(_MEMBER, "w", force_zip64=True) as member:
            size = declared if declared is not None else 64
            for _ in range(size // len(_CHUNK)):
                member.write(_CHUNK)
            member.write(bytes(size % len(_CHUNK)))
    raw = bytearray(out.getvalue())
    if corrupt:
        with zipfile.ZipFile(io.BytesIO(bytes(raw))) as z:
            info = z.getinfo(_MEMBER)
        name_length, extra_length = struct.unpack_from("<HH", raw, info.header_offset + 26)
        start = info.header_offset + 30 + name_length + extra_length
        raw[start : start + info.compress_size] = b"\xff" * info.compress_size
    return bytes(raw)


@pytest.fixture
def over_ceiling() -> bytes:
    return _archive_with(presetzip.MEMBER_CEILING + 1)


@pytest.fixture
def corrupt_member() -> bytes:
    return _archive_with(None, corrupt=True)


def test_a_member_declaring_more_than_the_ceiling_is_refused_unread(over_ceiling: bytes) -> None:
    with pytest.raises(presetzip.ArchiveOverCeilingError):
        presetzip.snapshot_members(over_ceiling)


def test_a_member_that_will_not_decompress_is_an_unreadable_archive(corrupt_member: bytes) -> None:
    with pytest.raises(engineconf.UnreadableArchiveError):
        presetzip.snapshot_members(corrupt_member)


def _served(archive: bytes, tmp_path: Path) -> Iterator[TestClient]:
    """The app connecting to a fake 8088 daemon whose first reads of ``/backup`` serve ``archive``."""
    daemon = fake_http.spawn(fake_http.state(_pre_backup=archive, _stale=1_000_000), in_process=True)
    http = next(daemon)
    control = spawn_threaded_daemon()
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=next(control),
        hqp_http_port=http["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    with ready_app(cfg) as client:
        yield log_in(client)
    next(control, None)
    next(daemon, None)


@pytest.fixture
def connected_over_ceiling(over_ceiling: bytes, tmp_path: Path) -> Iterator[TestClient]:
    yield from _served(over_ceiling, tmp_path)


@pytest.fixture
def connected_corrupt(corrupt_member: bytes, tmp_path: Path) -> Iterator[TestClient]:
    yield from _served(corrupt_member, tmp_path)


def _presets(client: TestClient) -> str:
    return str(client.get("/api/config").json()["data"]["profiles"])


def test_a_connect_over_an_archive_past_the_ceiling_imports_no_preset(connected_over_ceiling: TestClient) -> None:
    assert "x" not in str(_presets(connected_over_ceiling))


def test_a_connect_over_an_archive_with_a_corrupt_member_stands(connected_corrupt: TestClient) -> None:
    assert connected_corrupt.get("/api/health").status_code == 200
