"""The login route, over the wire against the fake 8088 daemon (docs/testing.md).

HQPTuner's own pair check is never replaced: every case logs in through ``POST /api/login`` and the fake daemon
answers the Digest request the check sends. Every record file lives under ``tmp_path``.
"""

import hashlib
import re
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import fake_http
import httpx
import pytest
from apps import cookie_of
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord, ConnectionStore
from hqptuner.core.login import SAVED_LIFETIME

PAIR = {"username": "admin", "password": "pw"}
ALIAS = "127.0.0.2"

Serve = Callable[..., dict[str, Any]]
Build = Callable[..., TestClient]


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def serve() -> Iterator[Serve]:
    """Serve a fake 8088 daemon with the given state overrides; every one is taken down at teardown."""
    servers: list[Iterator[dict[str, Any]]] = []

    def start(host: str = "127.0.0.1", port: int = 0, **overrides: object) -> dict[str, Any]:
        server = fake_http.spawn(fake_http.state(**overrides), host=host, bind_port=port)
        servers.append(server)
        return next(server)

    yield start
    for server in servers:
        next(server, None)


@pytest.fixture
def build(tmp_path: Path, store_path: Path, closed_port: int) -> Iterator[Build]:
    """Build the app with the pair admin/pw in force and its 8088 lane on ``port``; ``record`` is stored first."""
    with ExitStack() as stack:

        def make(port: int, *, record: ConnectionRecord | None = None) -> TestClient:
            if record is not None:
                ConnectionStore(store_path).write(record)
            cfg = Config(
                hqp_host="127.0.0.1",
                hqp_control_port=closed_port,
                hqp_http_port=port,
                hqp_username="admin",
                hqp_password="pw",
                connection_file=store_path,
                backup_dir=tmp_path,
                preset_dir=tmp_path / "presets",
            )
            return stack.enter_context(TestClient(create_app(cfg, VirtualClock())))

        yield make


def log_in(client: TestClient, *, remember: bool = False, **fields: object) -> httpx.Response:
    response: httpx.Response = client.post("/api/login", json={**PAIR, "remember": remember, **fields})
    return response


def digest_built_from(header: str, password: str) -> bool:
    """Whether the Digest ``Authorization`` header was built from ``password``."""
    fields: dict[str, str] = dict(re.findall(r'(\w+)="?([^",]*)"?', header))

    def md5(text: str) -> str:
        return hashlib.md5(text.encode(), usedforsecurity=False).hexdigest()

    ha1 = md5(f"{fields['username']}:{fields['realm']}:{password}")
    ha2 = md5(f"GET:{fields['uri']}")
    return fields["response"] == md5(f"{ha1}:{fields['nonce']}:{fields['nc']}:{fields['cnonce']}:{fields['qop']}:{ha2}")


def test_a_wrong_pair_is_refused_and_sets_no_cookie(serve: Serve, build: Build) -> None:
    response = log_in(build(serve(_refuse_auth=True)["_port"]))
    assert (response.status_code, response.json()["code"], "set-cookie" in response.headers) == (
        401,
        "login_refused",
        False,
    )


def test_a_correct_pair_sets_a_cookie_scripts_cannot_read_and_other_sites_cannot_send(
    serve: Serve, build: Build
) -> None:
    morsel = cookie_of(log_in(build(serve()["_port"])))
    assert (morsel["httponly"], morsel["samesite"].lower(), morsel["path"], morsel["secure"]) == (
        True,
        "strict",
        "/",
        "",
    )


@pytest.mark.parametrize(
    ("remember", "max_age"),
    [(False, ""), (True, str(int(SAVED_LIFETIME.total_seconds())))],
    ids=["log-in-every-time-is-a-session-cookie", "save-password-lasts-the-login-lifetime"],
)
def test_the_cookie_lasts_as_long_as_the_choice_the_login_made(
    serve: Serve, build: Build, max_age: str, *, remember: bool
) -> None:
    morsel = cookie_of(log_in(build(serve()["_port"]), remember=remember))
    assert (morsel["max-age"], morsel["expires"]) == (max_age, "")


def test_a_daemon_that_does_not_answer_is_not_a_refusal_and_sets_no_cookie(build: Build, closed_port: int) -> None:
    response = log_in(build(closed_port))
    assert (response.status_code, response.json()["code"], "set-cookie" in response.headers) == (
        503,
        "login_not_answered",
        False,
    )


def test_a_blank_password_is_checked_as_blank_never_filled_from_the_pair_in_force(serve: Serve, build: Build) -> None:
    daemon = serve(_challenge_auth=True)
    log_in(build(daemon["_port"]), password="")
    header = daemon["_authorizations"][-1]["header"]
    assert [digest_built_from(header, ""), digest_built_from(header, "pw")] == [True, False]


def test_a_login_naming_another_host_is_checked_against_that_host(serve: Serve, build: Build) -> None:
    refusing = serve(_refuse_auth=True)
    serve(host=ALIAS, port=refusing["_port"])
    client = build(refusing["_port"], record=ConnectionRecord("127.0.0.1", "admin", "pw", remember=True))
    assert log_in(client, host=ALIAS).status_code == 200


def test_an_accepted_login_naming_another_host_retargets_to_it(serve: Serve, build: Build) -> None:
    refusing = serve(_refuse_auth=True)
    serve(host=ALIAS, port=refusing["_port"])
    client = build(refusing["_port"], record=ConnectionRecord("127.0.0.1", "admin", "pw", remember=True))
    log_in(client, host=ALIAS)
    assert client.get("/api/connection").json()["host"] == ALIAS


def test_an_accepted_login_with_a_new_pair_becomes_the_pair_in_force(serve: Serve, build: Build) -> None:
    client = build(serve()["_port"])
    log_in(client, username="other", password="new")
    assert client.get("/api/connection").json()["username"] == "other"


@pytest.mark.parametrize(
    ("stored", "remember"),
    [
        (ConnectionRecord("127.0.0.1", "admin", "pw", remember=True), False),
        (ConnectionRecord("127.0.0.1", "admin", "", remember=False), True),
    ],
    ids=["save-record-log-in-every-time", "ask-record-save-password"],
)
def test_a_login_never_changes_the_stored_remember_choice(
    serve: Serve, build: Build, store_path: Path, stored: ConnectionRecord, *, remember: bool
) -> None:
    client = build(serve()["_port"], record=stored)
    before = store_path.read_bytes()
    response = log_in(client, remember=remember, password=stored.password)
    assert (response.status_code, store_path.read_bytes() == before) == (200, True)


def test_a_new_pair_over_an_ask_every_time_record_is_stored_without_a_password(
    serve: Serve, build: Build, store_path: Path
) -> None:
    client = build(serve()["_port"], record=ConnectionRecord("127.0.0.1", "admin", "", remember=False))
    log_in(client, remember=True, username="other", password="new")
    assert ConnectionStore(store_path).read() == ConnectionRecord("127.0.0.1", "other", "", remember=False)


def test_a_login_that_changes_nothing_writes_no_record(serve: Serve, build: Build, store_path: Path) -> None:
    response = log_in(build(serve()["_port"]), remember=True)
    assert (response.status_code, store_path.exists()) == (200, False)
