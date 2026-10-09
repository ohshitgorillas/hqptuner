"""How the REST API reports a request to HQPlayer's 8088 configuration lane that
failed, in place of the raw transport text.

The wording is owner copy and is not asserted (docs/testing.md rule 9). What is
asserted is what the fixtures supplied: an unreachable daemon's ``detail`` names
the ``host:port`` the app dialed, a refusing daemon's names the status number the
fake answered, and neither carries the raw httpx text nor the URL it was asked at.

Two failures are driven through the wire, never by patching our own code: a
port nothing listens on, and a fake 8088 daemon that answers every request with
one status from the test's table. A timeout is not driven here: the 8088 lane
times out on the real clock, so reaching it would need a real wait, which
docs/testing.md rule 7 forbids.
"""

import re
from collections.abc import Callable, Iterator
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import wait_for_api
from fastapi.testclient import TestClient
from httpx import Response
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: Where every app in this file looks for HQPlayer.
HOST = "127.0.0.1"

#: Two error statuses, so a report that names one status for every refusal
#: shows up as the wrong number on the other.
REFUSAL_STATUSES = [500, 503]

#: The text httpx raises with when nothing listens on the port it dialed.
CONNECT_FAILED = "All connection attempts failed"

#: What `_detail` reads off an answer whose body carries no `detail`, so a case
#: looking for a value in it fails the assertion instead of erroring out of it.
NO_DETAIL = ""


def where(port: int) -> str:
    """The address the app dialed, as ``host:port``."""
    return f"{HOST}:{port}"


def base_url(port: int) -> str:
    """The start of every URL the app asks a fake daemon on ``port`` for."""
    return f"http://{HOST}:{port}/"


def _detail(resp: Response) -> str:
    try:
        body = resp.json()
    except ValueError:  # an unhandled failure answers in plain text
        return NO_DETAIL
    detail = body.get("detail", NO_DETAIL) if isinstance(body, dict) else NO_DETAIL
    return detail if isinstance(detail, str) else NO_DETAIL


def _numbers(text: str) -> list[int]:
    """Every whole number written in ``text``."""
    return [int(n) for n in re.findall(r"\d+", text)]


def _config(tmp_path: Path, control_port: int, http_port: int) -> Config:
    """The `http_client` app's config, its 8088 lane at ``http_port``."""
    return Config(
        hqp_host=HOST,
        hqp_control_port=control_port,
        hqp_http_port=http_port,
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        advisor_enabled=True,
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
    )


def _app(tmp_path: Path, control_port: int, http_port: int) -> Iterator[TestClient]:
    # an exception the app lets escape is answered the way a browser sees it,
    # a bare 500, rather than raised into the test
    app = create_app(_config(tmp_path, control_port, http_port), VirtualClock())
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def _status_handler(status: int) -> type[BaseHTTPRequestHandler]:
    """An 8088 daemon that answers every request with ``status`` and no body."""

    class Handler(BaseHTTPRequestHandler):
        def _answer(self) -> None:
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            self._answer()

        def do_POST(self) -> None:
            self._answer()

        def log_message(self, *_: object) -> None:
            pass

    return Handler


@pytest.fixture
def refusing_daemon() -> Iterator[Callable[[int], int]]:
    """Start a fake 8088 daemon answering every request with the given status,
    returning its port."""
    daemons: list[Iterator[dict[str, Any]]] = []

    def start(status: int) -> int:
        daemon = fake_http.spawn({}, handler=_status_handler(status))
        daemons.append(daemon)
        port: int = next(daemon)["_port"]
        return port

    yield start
    for daemon in daemons:
        next(daemon, None)


@pytest.fixture
def deaf_api(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """Credentials configured, nothing listening on either daemon port."""
    yield from _app(tmp_path, closed_port, closed_port)


@pytest.fixture
def refusing_api(
    tmp_path: Path, closed_port: int, refusing_daemon: Callable[[int], int]
) -> Iterator[Callable[[int], tuple[TestClient, int]]]:
    """Build the app on an 8088 daemon answering every request with the given
    status, returning the client and the daemon's port."""
    apps: list[Iterator[TestClient]] = []

    def build(status: int) -> tuple[TestClient, int]:
        port = refusing_daemon(status)
        app = _app(tmp_path, closed_port, port)
        apps.append(app)
        return next(app), port

    yield build
    for app in apps:
        next(app, None)


Send = Callable[[TestClient], Response]

#: The settings backup download, an operation on the 8088 lane.
BACKUP: Any = pytest.param(lambda c: c.get("/api/backup"), id="backup")

#: Each other operation on the 8088 lane, as the REST request that performs it.
#: The preview of "(no preset)" is the running config, so it always reads the
#: daemon.
NON_BACKUP_OPERATIONS: list[Any] = [
    pytest.param(lambda c: c.get("/api/preset/"), id="preset-preview"),
    pytest.param(lambda c: c.post("/api/config/refresh"), id="refresh-devices"),
    pytest.param(lambda c: c.get("/api/engine"), id="engine-read"),
    pytest.param(lambda c: c.post("/api/engine", json={"overrides": {"cuda": "0"}}), id="engine-apply"),
    pytest.param(
        lambda c: c.post("/api/restore", files={"cfgfile": ("s.zip", b"PK\x03\x04junk", "application/zip")}),
        id="restore-upload",
    ),
    pytest.param(lambda c: c.post("/api/speakers", json={"enabled": True}), id="speakers-apply"),
    pytest.param(lambda c: c.get("/api/log"), id="log-read"),
]

#: Every operation on the 8088 lane.
OPERATIONS: list[Any] = [BACKUP, *NON_BACKUP_OPERATIONS]


@pytest.mark.parametrize("send", OPERATIONS)
def test_an_operation_that_cannot_reach_hqplayer_names_where_it_looked(
    deaf_api: TestClient, closed_port: int, send: Send
) -> None:
    assert where(closed_port) in _detail(send(deaf_api))


@pytest.mark.parametrize("send", NON_BACKUP_OPERATIONS)
def test_an_operation_that_cannot_reach_hqplayer_drops_the_raw_connect_error(deaf_api: TestClient, send: Send) -> None:
    assert CONNECT_FAILED not in _detail(send(deaf_api))


@pytest.mark.parametrize("status", REFUSAL_STATUSES)
@pytest.mark.parametrize("send", [BACKUP])
def test_an_operation_hqplayer_refuses_names_the_status_it_answered(
    refusing_api: Callable[[int], tuple[TestClient, int]], send: Send, status: int
) -> None:
    client, _ = refusing_api(status)
    assert status in _numbers(_detail(send(client)))


@pytest.mark.parametrize("status", REFUSAL_STATUSES)
@pytest.mark.parametrize("send", NON_BACKUP_OPERATIONS)
def test_an_operation_hqplayer_refuses_drops_the_url_it_asked_at(
    refusing_api: Callable[[int], tuple[TestClient, int]], send: Send, status: int
) -> None:
    client, port = refusing_api(status)
    assert base_url(port) not in _detail(send(client))


# --- a polled form whose own read failed ----------------------------------------

FORMS = ["/api/config", "/api/matrix", "/api/speakers"]


def _form_failed(client: TestClient) -> bool:
    # /speakers is the last form the connect sequence fetches: once it reports
    # its failed read, all three reads are recorded
    resp: Response = client.get("/api/speakers")
    return resp.status_code == HTTPStatus.BAD_GATEWAY


@pytest.fixture
def connected_api(tmp_path: Path, threaded_daemon_port: int) -> Iterator[Callable[[int], TestClient]]:
    """Build the app with its control lane live, so the connect sequence reads
    every form over the 8088 lane at the given port, and wait until it has."""
    apps: list[Iterator[TestClient]] = []

    def build(http_port: int) -> TestClient:
        app = _app(tmp_path, threaded_daemon_port, http_port)
        apps.append(app)
        client = next(app)
        wait_for_api(client, _form_failed)
        return client

    yield build
    for app in apps:
        next(app, None)


@pytest.mark.parametrize("path", FORMS)
def test_a_form_whose_read_could_not_reach_hqplayer_names_where_it_looked(
    connected_api: Callable[[int], TestClient], closed_port: int, path: str
) -> None:
    assert where(closed_port) in _detail(connected_api(closed_port).get(path))


@pytest.mark.parametrize("path", FORMS)
def test_a_form_whose_read_could_not_reach_hqplayer_drops_the_raw_connect_error(
    connected_api: Callable[[int], TestClient], closed_port: int, path: str
) -> None:
    assert CONNECT_FAILED not in _detail(connected_api(closed_port).get(path))


@pytest.mark.parametrize("status", REFUSAL_STATUSES)
@pytest.mark.parametrize("path", FORMS)
def test_a_form_whose_read_hqplayer_refused_drops_the_url_it_asked_at(
    connected_api: Callable[[int], TestClient], refusing_daemon: Callable[[int], int], path: str, status: int
) -> None:
    port = refusing_daemon(status)
    assert base_url(port) not in _detail(connected_api(port).get(path))
