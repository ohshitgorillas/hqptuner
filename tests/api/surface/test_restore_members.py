"""A restore archive's member names are held to the shape the daemon's own backups have.

A name that could land outside the daemon's data directory, or a stray file at the archive root beside the working
config, is refused and nothing is sent to the daemon. The accepted shapes are the real backups' own: the working
config at the root and everything else under ``data/``.
"""

import io
import zipfile
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

_BAD_NAMES = ["/etc/x", "data/../x", "data\\x", "C:x.xml", "hqplayerd-auth.xml", "run.sh"]


def _with_member(base: bytes, name: str) -> bytes:
    """``base``'s members plus one more named ``name``."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as source, zipfile.ZipFile(out, "w") as z:
        for item in source.infolist():
            z.writestr(item, source.read(item.filename))
        z.writestr(zipfile.ZipInfo(name), b"x")
    return out.getvalue()


def _hostlike(working: bytes) -> bytes:
    """An archive shaped like the daemon's own backup: a ``data/`` directory entry, the working config, and files
    under ``data/``."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("data/", b"")
        z.writestr("hqplayerd.xml", working)
        z.writestr("data/cfgs/A.xml", working)
        z.writestr("data/impulse_0-0.wav", b"RIFF")
    return out.getvalue()


def _upload(client: TestClient, data: bytes) -> httpx.Response:
    response: httpx.Response = client.post("/api/restore", files={"cfgfile": ("settings.zip", data, "application/zip")})
    return response


def _working_config(client: TestClient) -> bytes:
    with zipfile.ZipFile(io.BytesIO(client.get("/api/backup").content)) as z:
        return z.read("hqplayerd.xml")


@pytest.fixture(params=_BAD_NAMES)
def bad_member(request: pytest.FixtureRequest, http_client: TestClient) -> bytes:
    return _with_member(http_client.get("/api/backup").content, request.param)


def test_an_archive_with_a_member_name_outside_the_backup_shape_is_refused(
    http_client: TestClient, bad_member: bytes
) -> None:
    assert _upload(http_client, bad_member).json()["code"] == "invalid_input"


def test_a_refused_member_name_sends_the_daemon_no_restore_beside_one_that_is_sent(
    http_client: TestClient, http_daemon: dict[str, Any], bad_member: bytes
) -> None:
    _upload(http_client, bad_member)
    _upload(http_client, http_client.get("/api/backup").content)
    assert http_daemon["_restore_attempts"] == 1


def test_an_archive_shaped_like_the_daemons_own_backup_is_restored(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    _upload(http_client, _hostlike(_working_config(http_client)))
    assert http_daemon["_restore_attempts"] == 1


def test_an_archive_with_a_preset_active_working_config_is_restored(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_active_profile"] = "Speakers"
    _upload(http_client, http_client.get("/api/backup").content)
    assert http_daemon["_restore_attempts"] == 1
