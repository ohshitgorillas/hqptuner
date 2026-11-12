"""A restore upload is bounded: an upload past its ceiling, or an archive declaring more than its members may hold, is
refused before the daemon is sent anything.

An over-ceiling archive is built with a stored (uncompressed) padding member, so its size is the ceiling plus one
byte exactly and the fake daemon's own archive reader accepts it: pre-change, the fake adopts it.
"""

import io
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from apps import log_in, ready_app
from fastapi.testclient import TestClient

from hqptuner.conf.presetzip import DESCRIPTIONS_MEMBER, MEMBER_CEILING, RESTORE_UPLOAD_CEILING
from hqptuner.config import Config

_PAD = "data/pad.bin"


def _archive_of_size(base: bytes, size: int) -> bytes:
    """``base``'s members plus one stored padding member, the whole archive exactly ``size`` bytes."""
    with zipfile.ZipFile(io.BytesIO(base)) as source:
        members = [(item, source.read(item.filename)) for item in source.infolist()]

    def build(pad: int) -> bytes:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
            for item, data in members:
                z.writestr(item, data)
            z.writestr(_PAD, bytes(pad))
        return out.getvalue()

    return build(size - len(build(0)))


def _upload(client: TestClient, data: bytes) -> httpx.Response:
    response: httpx.Response = client.post("/api/restore", files={"cfgfile": ("settings.zip", data, "application/zip")})
    return response


@pytest.fixture
def over_ceiling(http_client: TestClient) -> bytes:
    return _archive_of_size(http_client.get("/api/backup").content, RESTORE_UPLOAD_CEILING + 1)


def test_an_upload_one_byte_over_the_ceiling_is_refused(http_client: TestClient, over_ceiling: bytes) -> None:
    assert _upload(http_client, over_ceiling).json()["code"] == "invalid_input"


def test_a_refused_oversize_upload_sends_the_daemon_no_restore_beside_one_that_is_sent(
    http_client: TestClient, http_daemon: dict[str, Any], over_ceiling: bytes
) -> None:
    _upload(http_client, over_ceiling)
    _upload(http_client, http_client.get("/api/backup").content)
    assert http_daemon["_restore_attempts"] == 1


@pytest.fixture
def answering_client(http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The app on both fake daemons, answering a crash as the bare 500 a browser would get."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=http_daemon["_port"],
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
    with ready_app(cfg, raise_server_exceptions=False) as client:
        yield log_in(client)


_CHUNK = bytes(2**20)


def _declaring(base: bytes, sizes: list[int]) -> bytes:
    """``base``'s members plus one deflated member per size, each decompressing to that many zero bytes.

    The zeros are streamed in chunks, so the decompressed bytes are never held; the archive is a few hundred KiB.
    """
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in source.infolist():
            z.writestr(item, source.read(item.filename))
        for n, size in enumerate(sizes):
            with z.open(f"data/declared-{n}.bin", "w", force_zip64=True) as member:
                for _ in range(size // len(_CHUNK)):
                    member.write(_CHUNK)
                member.write(bytes(size % len(_CHUNK)))
    return out.getvalue()


def _with_corrupt_member(base: bytes, name: str) -> bytes:
    """``base`` with ``name`` added as a deflated member whose stream is overwritten, central directory intact."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in source.infolist():
            z.writestr(item, source.read(item.filename))
        z.writestr(name, b'{"schema": 1, "profiles": {}}' * 8)
    raw = bytearray(out.getvalue())
    with zipfile.ZipFile(io.BytesIO(bytes(raw))) as z:
        info = z.getinfo(name)
    start = info.header_offset + 30 + len(name.encode()) + len(info.extra)
    raw[start : start + info.compress_size] = b"\xff" * info.compress_size
    return bytes(raw)


@pytest.fixture(
    params=[
        pytest.param([MEMBER_CEILING + 1], id="one-member-over"),
        pytest.param([MEMBER_CEILING, MEMBER_CEILING, 1], id="total-over"),
    ]
)
def over_declared(request: pytest.FixtureRequest, answering_client: TestClient) -> bytes:
    declared: bytes = _declaring(answering_client.get("/api/backup").content, request.param)
    return declared


def test_an_archive_declaring_more_than_its_ceilings_is_refused(
    answering_client: TestClient, over_declared: bytes
) -> None:
    assert _upload(answering_client, over_declared).json()["code"] == "invalid_input"


def test_a_refused_over_declared_archive_sends_the_daemon_no_restore_beside_one_that_is_sent(
    answering_client: TestClient, http_daemon: dict[str, Any], over_declared: bytes
) -> None:
    _upload(answering_client, over_declared)
    _upload(answering_client, answering_client.get("/api/backup").content)
    assert http_daemon["_restore_attempts"] == 1


@pytest.fixture
def corrupt_descriptions(answering_client: TestClient) -> bytes:
    return _with_corrupt_member(answering_client.get("/api/backup").content, DESCRIPTIONS_MEMBER)


def test_an_archive_with_a_corrupt_member_is_refused_with_a_client_error(
    answering_client: TestClient, corrupt_descriptions: bytes
) -> None:
    assert _upload(answering_client, corrupt_descriptions).status_code // 100 == 4
