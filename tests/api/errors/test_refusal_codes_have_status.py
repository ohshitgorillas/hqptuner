"""Every code a refusal can carry has a status.

A refusal is answered in the shared ``{"detail": ..., "code": ...}`` shape, at
the status its code maps to in ``hqptuner.api.errors.STATUS``. A refusal whose
code the table does not map is a defect: the error path itself fails and the
client gets a bare 500 with no ``code`` at all.

The app here is built with ``raise_server_exceptions=False`` so that a crash on
the error path reaches the test as the bare answer a browser would get, rather
than as an exception out of the client."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.errors import STATUS
from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The code a connection save answers when its record cannot be written.
STORE_UNWRITABLE = "store_unwritable"

#: The status the owner fixed for that code.
STORE_UNWRITABLE_STATUS = 500

#: What ``_code`` reads off an answer that carries no ``code``: a bare crash
#: page, or a JSON body without the key. No case expects it.
NO_CODE = ""

#: A whole connection, as the first-run screen sends one.
CONNECTION = {"host": "127.0.0.1", "username": "u", "password": "p", "remember": True}


def _code(resp: Response) -> str:
    """The ``code`` an answer carries, or ``NO_CODE``."""
    try:
        body = resp.json()
    except ValueError:
        return NO_CODE
    code = body.get("code", NO_CODE) if isinstance(body, dict) else NO_CODE
    return str(code)


@pytest.fixture
def record_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def client(closed_port: int, http_daemon: dict[str, Any], tmp_path: Path, record_path: Path) -> Iterator[TestClient]:
    """The REST app on the fake 8088 daemon, its connection record in tmp,
    answering a crash as a response instead of raising it into the test."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        connection_file=record_path,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg, VirtualClock()), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def blocked_save(client: TestClient, record_path: Path) -> Response:
    """A connection saved after its record path has become a directory, so the
    store cannot write the record whatever the process's privileges."""
    if record_path.exists():
        raise FixtureError(reason="the connection record was written before the store was blocked")
    record_path.mkdir()
    resp: Response = client.post("/api/connection", json=CONNECTION)
    return resp


def test_a_connection_save_the_store_cannot_hold_carries_code_store_unwritable(blocked_save: Response) -> None:
    assert _code(blocked_save) == STORE_UNWRITABLE


def test_a_connection_save_the_store_cannot_hold_answers_at_its_codes_status(blocked_save: Response) -> None:
    assert blocked_save.status_code == STATUS.get(_code(blocked_save))


def test_store_unwritable_answers_500() -> None:
    assert STATUS.get(STORE_UNWRITABLE) == STORE_UNWRITABLE_STATUS
