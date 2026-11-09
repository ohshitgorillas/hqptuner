"""The Connection save refuses a host that is not a daemon address (docs/testing.md).

One host rule decides what the save may carry: a hostname, an IPv4 literal or a bare IPv6 literal. A refused save
writes no record, leaves the live connection alone and sends nothing to any daemon. ``detail`` is copy and is never
asserted (rule 9). The app is built with ``raise_server_exceptions=False`` so a host the 8088 client cannot build a URL
for reaches the test as the answer a browser would get, not as an exception out of the client.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from apps import log_in
from fake_network import NETWORK
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

HOST_INVALID = "host_invalid"

#: One host per class of input the save used to carry into ``http://{host}:{port}``.
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
        log_in(test_client)
        yield test_client


@pytest.mark.parametrize("host", INVALID_HOSTS)
def test_a_save_naming_an_invalid_host_is_refused_and_writes_nothing(
    client: TestClient, record_path: Path, http_daemon: dict[str, Any], host: str
) -> None:
    sent = http_daemon["_requests"]
    response = client.post("/api/connection", json={"host": host})
    assert (
        response.json().get("code"),
        record_path.exists(),
        client.get("/api/connection").json()["host"],
        http_daemon["_requests"] - sent,
    ) == (HOST_INVALID, False, "127.0.0.1", 0)


def test_a_save_naming_the_ipv6_loopback_stores_it_bare(client: TestClient, record_path: Path) -> None:
    client.post("/api/connection", json={"host": "::1"})
    assert json.loads(record_path.read_text(encoding="utf-8"))["host"] == "::1"
