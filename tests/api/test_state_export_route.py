"""`GET /api/state-export`: HQPTuner's own state files as one zip download, for
a user to attach to a bug report.

The app is built over stores in ``tmp_path``, so the files the export reads are
the ones each case seeds. A response that is not a zip reads as an archive with
no members, so a missing route fails the assertion rather than raising.
"""

import io
import json
import zipfile
from collections.abc import Iterator
from email.message import Message
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from fixtures_clients import app

ROUTE = "/api/state-export"

#: The favorites record seeded on disk before the app starts.
FAVORITES = {"schema": 1, "filters": ["poly-sinc-gauss-long", "sinc-M"]}

FAVORITES_MEMBER = "favorites.json"
ZIP_MEDIA_TYPE = "application/zip"
ATTACHMENT = ("attachment", "hqptuner-state.zip")


@pytest.fixture
def export_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    (tmp_path / FAVORITES_MEMBER).write_text(json.dumps(FAVORITES))
    yield from app(http_daemon, tmp_path, closed_port, None)


def zip_member(body: bytes, name: str) -> object:
    """The parsed JSON of one archive member, or None when the body is not a
    zip or carries no member by that name."""
    buffer = io.BytesIO(body)
    if not zipfile.is_zipfile(buffer):
        return None
    with zipfile.ZipFile(buffer) as archive:
        if name not in archive.namelist():
            return None
        return json.loads(archive.read(name))


def disposition(header: str) -> tuple[str | None, str | None]:
    """The disposition type and filename a Content-Disposition header names."""
    message = Message()
    message["content-disposition"] = header
    return message.get_content_disposition(), message.get_filename()


def test_the_export_archive_carries_the_favorites_file_on_disk(export_client: TestClient) -> None:
    response = export_client.get(ROUTE)
    assert zip_member(response.content, FAVORITES_MEMBER) == FAVORITES


def test_the_export_is_served_as_a_zip(export_client: TestClient) -> None:
    response = export_client.get(ROUTE)
    assert response.headers.get("content-type") == ZIP_MEDIA_TYPE


def test_the_export_downloads_as_an_attachment_named_hqptuner_state_zip(export_client: TestClient) -> None:
    response = export_client.get(ROUTE)
    assert disposition(response.headers.get("content-disposition", "")) == ATTACHMENT
