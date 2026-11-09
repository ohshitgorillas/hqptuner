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

import fake_http
import pytest
from apps import log_in
from fake_network import NETWORK
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

HOST_INVALID = "host_invalid"
CREDENTIALS_REQUIRED = "credentials_required"

#: Another loopback address, so a fake 8088 can be served there and counted apart from the one in force.
ALIAS = "127.0.0.2"

#: One host per class of input the save used to carry into ``http://{host}:{port}``.
INVALID_HOSTS = ["a:b", "target:9000/path?x=", "fe80::1%eth0"]


@pytest.fixture
def record_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def alias_daemon(http_daemon: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """A fake 8088 at ``ALIAS`` on the port the app dials, standing for the host a save would switch to."""
    server = fake_http.spawn(fake_http.state(), host=ALIAS, bind_port=http_daemon["_port"], in_process=True)
    yield next(server)
    next(server, None)


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
    client.post("/api/connection", json={"host": "::1", "username": "u", "password": "p", "remember": True})
    assert json.loads(record_path.read_text(encoding="utf-8"))["host"] == "::1"


#: A host-changing save that does not carry both the username and the password: one absent, one blank.
INCOMPLETE = [
    {"host": ALIAS, "username": "u"},
    {"host": ALIAS, "password": "p"},
    {"host": ALIAS, "username": "u", "password": ""},
    {"host": ALIAS, "username": "", "password": "p"},
]


@pytest.mark.parametrize("body", INCOMPLETE, ids=["no-password", "no-username", "blank-password", "blank-username"])
def test_a_save_changing_the_host_without_both_credentials_is_refused_and_sends_nothing(
    client: TestClient, record_path: Path, alias_daemon: dict[str, Any], body: dict[str, str]
) -> None:
    response = client.post("/api/connection", json=body)
    assert (
        response.json().get("code"),
        record_path.exists(),
        client.get("/api/connection").json()["host"],
        alias_daemon["_requests"],
    ) == (CREDENTIALS_REQUIRED, False, "127.0.0.1", 0)


def test_a_save_changing_the_host_with_both_credentials_is_accepted(client: TestClient, record_path: Path) -> None:
    response = client.post("/api/connection", json={"host": ALIAS, "username": "v", "password": "q", "remember": True})
    assert (response.status_code, json.loads(record_path.read_text(encoding="utf-8"))["host"]) == (200, ALIAS)


def test_a_save_to_the_same_host_with_no_password_keeps_the_stored_one(client: TestClient, record_path: Path) -> None:
    client.post("/api/connection", json={"host": "127.0.0.1", "username": "v", "remember": True})
    stored = json.loads(record_path.read_text(encoding="utf-8"))
    assert (stored["username"], stored["password"]) == ("v", "p")
