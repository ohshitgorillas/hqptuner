"""A restore upload is bounded: an upload past its ceiling, or an archive declaring more than its members may hold, is
refused before the daemon is sent anything.

An over-ceiling archive is built with a stored (uncompressed) padding member, so its size is the ceiling plus one
byte exactly and the fake daemon's own archive reader accepts it: pre-change, the fake adopts it.
"""

import io
import zipfile
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from hqptuner.conf.presetzip import RESTORE_UPLOAD_CEILING

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
