"""The login refuses a host that is not a daemon address before it asks any daemon (docs/testing.md).

The same host rule the Connection save keeps. ``detail`` is copy and is never asserted (rule 9).
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_network import NETWORK
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

HOST_INVALID = "host_invalid"

INVALID_HOSTS = ["a:b", "target:9000/path?x=", "fe80::1%eth0"]


@pytest.fixture
def record_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def client(closed_port: int, http_daemon: dict[str, Any], tmp_path: Path, record_path: Path) -> Iterator[TestClient]:
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
    with TestClient(create_app(cfg, VirtualClock(), NETWORK), raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.mark.parametrize("host", INVALID_HOSTS)
def test_a_login_naming_an_invalid_host_is_refused_with_no_cookie_no_record_and_no_request(
    client: TestClient, record_path: Path, http_daemon: dict[str, Any], host: str
) -> None:
    sent = http_daemon["_requests"]
    response = client.post("/api/login", json={"username": "u", "password": "p", "host": host})
    assert (
        response.json().get("code"),
        "set-cookie" in response.headers,
        record_path.exists(),
        http_daemon["_requests"] - sent,
    ) == (HOST_INVALID, False, False, 0)
