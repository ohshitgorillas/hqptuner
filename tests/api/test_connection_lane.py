"""What a connection save reports about its own 8088 attempt, and what the
record on disk says about keeping the password (docs/testing.md).

Every case parks the record file under ``tmp_path``: the Config default points
at the running install's own state, and conftest's guard covers the stores it
knows by name, so the override in `app_factory` below is the only thing between
a POST here and the install's real credentials.

The 8088 port is a hole by default and the fake daemon's where a case needs an
answer, never the default: the default on this host is the production daemon.
The four lane states are stated at the wire and nowhere else — an incomplete
pair, a daemon answering /config, one refusing the pair with 403
(`fake_http._auth_refusal`, verified on 6.0.4), and a port nothing listens on.
"""

from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord, ConnectionStore

AppFactory = Callable[..., TestClient]


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def app_factory(store_path: Path, closed_port: int, tmp_path: Path) -> Iterator[AppFactory]:
    """The REST app with its record file in tmp and its lanes pointed at holes.

    Keyword arguments override the Config: a case that needs a daemon to answer
    passes ``hqp_http_port``, and the default is the install that can reach
    nothing at all."""
    with ExitStack() as stack:

        def build(**overrides: Any) -> TestClient:
            cfg = Config(
                **{
                    "hqp_host": "127.0.0.1",
                    "hqp_control_port": closed_port,
                    "hqp_http_port": closed_port,
                    "hqp_username": "",
                    "hqp_password": "",
                    "connection_file": store_path,
                    "backup_dir": tmp_path,
                    "preset_dir": tmp_path / "presets",
                    **overrides,
                }
            )
            return stack.enter_context(TestClient(create_app(cfg)))

        yield build


def stored_choice(path: Path) -> tuple[str, bool]:
    """The host and the keep-the-password choice the record on disk holds, or the
    pair a route that wrote nothing leaves behind."""
    record = ConnectionStore(path).read()
    if record is None:
        return ("", True)
    return (record.host, record.remember)


@pytest.mark.parametrize(
    ("state", "lane"),
    [
        ("incomplete_pair", "no_credentials"),
        ("daemon_refuses_the_pair", "refused"),
        ("daemon_answers_config", "ok"),
        ("nothing_on_the_port", "no_answer"),
    ],
)
def test_a_save_reports_the_lane_its_own_config_attempt_reached(
    app_factory: AppFactory,
    http_daemon: dict[str, Any],
    closed_port: int,
    state: str,
    lane: str,
) -> None:
    # Four daemon states, four verdicts on the one field the panel reads back.
    # A route answering the refusal HQPTuner already held cannot tell the last
    # state from the second: the pair the daemon never saw was the rejected one.
    if state == "daemon_refuses_the_pair":
        http_daemon["_refuse_auth"] = True
    port = closed_port if state == "nothing_on_the_port" else int(http_daemon["_port"])
    client = app_factory(hqp_http_port=port)
    pair = {"username": "", "password": ""} if state == "incomplete_pair" else {"username": "u", "password": "p"}
    body: dict[str, Any] = {"host": "127.0.0.1", "remember": False, **pair}
    assert client.post("/api/connection", json=body).json().get("lane") == lane


@pytest.mark.parametrize(("stored", "answered"), [(None, False), (True, True)])
def test_an_unset_record_reads_as_ask_every_time_and_a_stored_choice_reads_back(
    app_factory: AppFactory, store_path: Path, *, stored: bool | None, answered: bool
) -> None:
    # The choice is the user's, so the install that never made one is reported
    # as not keeping the password; the install that asked to keep it still is.
    if stored is not None:
        record = ConnectionRecord(host="10.0.0.5", username="u", password="p", remember=stored)
        ConnectionStore(store_path).write(record)
    client = app_factory()
    assert client.get("/api/connection").json()["remember"] == answered


def test_a_save_silent_about_the_choice_leaves_the_stored_choice_alone(
    app_factory: AppFactory, store_path: Path
) -> None:
    # Correcting the address alone is a body that never mentions the password
    # choice. It must move the host and nothing else: an install that asked to
    # be asked every time does not become one that stores the password because
    # its owner fixed a typo in the address.
    asked = ConnectionRecord(host="127.0.0.1", username="tuner", password="p", remember=False)
    ConnectionStore(store_path).write(asked)
    client = app_factory()
    client.post("/api/connection", json={"host": "10.0.0.9"})
    assert stored_choice(store_path) == ("10.0.0.9", False)
