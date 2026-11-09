"""The Connection save refuses a host that is not a daemon address (docs/testing.md).

One host rule decides what the save may carry: a hostname, an IPv4 literal or a bare IPv6 literal. A refused save
writes no record, leaves the live connection alone and sends nothing to any daemon. ``detail`` is copy and is never
asserted (rule 9). The app is built with ``raise_server_exceptions=False`` so a host the 8088 client cannot build a URL
for reaches the test as the answer a browser would get, not as an exception out of the client.
"""

import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
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


Build = Callable[..., TestClient]


@pytest.fixture
def build(closed_port: int, http_daemon: dict[str, Any], tmp_path: Path, record_path: Path) -> Iterator[Build]:
    """Build the REST app, logged in, on the fake 8088 daemon; the host in force is the named one."""
    with ExitStack() as stack:

        def make(host: str = "127.0.0.1") -> TestClient:
            cfg = Config(
                hqp_host=host,
                hqp_control_port=closed_port,
                hqp_http_port=http_daemon["_port"],
                hqp_username="u",
                hqp_password="p",
                connection_file=record_path,
                backup_dir=tmp_path,
                preset_dir=tmp_path / "presets",
            )
            app = create_app(cfg, VirtualClock(), NETWORK)
            return log_in(stack.enter_context(TestClient(app, raise_server_exceptions=False)))

        yield make


@pytest.fixture
def client(build: Build) -> TestClient:
    return build()


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
    client.post("/api/connection", json={"username": "u", "password": "p", "remember": True})
    client.post("/api/connection", json={"host": "127.0.0.1", "username": "v", "remember": True})
    stored = json.loads(record_path.read_text(encoding="utf-8"))
    assert (stored["username"], stored["password"]) == ("v", "p")


LOGIN_VALUES_PINNED = "login_values_pinned"

#: The environment variable that pins each field, and the value this app's own config already holds for it.
PINS = {"host": "HQPTUNER_HQP_HOST", "username": "HQPTUNER_HQP_USERNAME", "password": "HQPTUNER_HQP_PASSWORD"}
PINNED_TO = {"host": "127.0.0.1", "username": "u", "password": "p"}


def pin(monkeypatch: pytest.MonkeyPatch, *fields: str) -> None:
    """Pin the named fields in the environment to the values the app holds, as the Docker install does."""
    for field, name in PINS.items():
        monkeypatch.delenv(name, raising=False)
        if field in fields:
            monkeypatch.setenv(name, PINNED_TO[field])


@pytest.mark.parametrize(
    "body",
    [
        {"host": ALIAS, "username": "u", "password": "p"},
        {"host": "127.0.0.1", "username": "u", "password": "other"},
    ],
    ids=["host", "password"],
)
def test_a_save_naming_a_value_the_environment_pins_differently_is_forbidden_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    record_path: Path,
    alias_daemon: dict[str, Any],
    body: dict[str, str],
) -> None:
    pin(monkeypatch, "host", "password")
    response = client.post("/api/connection", json=body)
    assert (response.json().get("code"), record_path.exists(), alias_daemon["_requests"]) == (
        LOGIN_VALUES_PINNED,
        False,
        0,
    )


def test_a_save_naming_exactly_the_pinned_values_is_accepted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    pin(monkeypatch, "host", "password")
    assert client.post("/api/connection", json={**PINNED_TO, "remember": False}).status_code == 200


def _pair(record_path: Path) -> tuple[str, str]:
    """The username and password the record file holds."""
    stored = _stored(record_path)
    return stored["username"], stored["password"]


def _stored(record_path: Path) -> dict[str, Any]:
    """The record file, parsed."""
    stored: dict[str, Any] = json.loads(record_path.read_text(encoding="utf-8"))
    return stored


def test_a_remembering_save_over_a_pinned_password_leaves_it_out_of_the_file(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, record_path: Path
) -> None:
    pin(monkeypatch, "password")
    client.post("/api/connection", json={"username": "v", "remember": True})
    assert _pair(record_path) == ("v", "")


def test_a_remembering_save_with_no_password_does_not_store_one_typed_in_an_earlier_save(
    client: TestClient, record_path: Path
) -> None:
    client.post("/api/connection", json={"username": "v", "password": "typed", "remember": False})
    client.post("/api/connection", json={"username": "v", "remember": True})
    assert _pair(record_path) == ("v", "")


@pytest.mark.usefixtures("alias_daemon")
def test_a_save_over_a_pinned_host_leaves_it_out_of_the_file(
    monkeypatch: pytest.MonkeyPatch, build: Build, record_path: Path
) -> None:
    monkeypatch.setenv(PINS["host"], ALIAS)
    build(ALIAS).post("/api/connection", json={"username": "v"})
    assert _stored(record_path)["host"] != ALIAS


def test_a_file_written_under_a_pin_starts_the_app_once_the_pin_is_gone(
    monkeypatch: pytest.MonkeyPatch, build: Build, record_path: Path, closed_port: int, tmp_path: Path
) -> None:
    pin(monkeypatch, "host", "password")
    build().post("/api/connection", json={"username": "v", "remember": True})
    pin(monkeypatch)
    cfg = Config(hqp_control_port=closed_port, connection_file=record_path, backup_dir=tmp_path)
    with TestClient(create_app(cfg, VirtualClock(), NETWORK)) as fresh:
        assert fresh.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "held",
    ["{not json", json.dumps({"schema": 1, "host": "a:b", "username": "u", "password": "held", "remember": True})],
    ids=["corrupt", "invalid-host"],
)
def test_a_remembering_save_over_an_unusable_record_succeeds_and_holds_no_password(
    client: TestClient, record_path: Path, held: str
) -> None:
    record_path.write_text(held, encoding="utf-8")
    client.post("/api/connection", json={"username": "v", "remember": True})
    assert _pair(record_path) == ("v", "")
