"""What a connection save reports about its own 8088 attempt (docs/testing.md).

Every case parks the record file under ``tmp_path``: the Config default points
at the running install's own state, and conftest's guard covers the stores it
knows by name, so the override in `app_factory` below is the only thing between
a POST here and the install's real credentials.

The app starts ready on both fake daemons and the 8088 daemon's answer is moved
mid-run, never the default port: the default on this host is the production
daemon. The four lane states are stated at the wire and nowhere else — an
incomplete pair, a daemon answering /config, one refusing the pair with 403
(`fake_http._auth_refusal`, verified on 6.0.4), and a daemon that has gone away.
"""

from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import pytest
from apps import log_in, ready_app
from fastapi.testclient import TestClient

from hqptuner.config import Config

AppFactory = Callable[..., TestClient]


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def app_factory(
    store_path: Path, threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> Iterator[AppFactory]:
    """The REST app with its record file in tmp, on both fake daemons, ready and logged in."""
    with ExitStack() as stack:

        def build() -> TestClient:
            cfg = Config(
                hqp_host="127.0.0.1",
                hqp_control_port=threaded_daemon_port,
                hqp_http_port=http_daemon["_port"],
                hqp_username="u",
                hqp_password="p",
                connection_file=store_path,
                backup_dir=tmp_path,
                preset_dir=tmp_path / "presets",
            )
            return log_in(stack.enter_context(ready_app(cfg)))

        yield build


@pytest.mark.parametrize(
    ("state", "lane"),
    [
        ("incomplete_pair", "no_credentials"),
        ("daemon_refuses_the_pair", "refused"),
        ("daemon_answers_config", "ok"),
        ("daemon_gone", "no_answer"),
    ],
)
def test_a_save_reports_the_lane_its_own_config_attempt_reached(
    app_factory: AppFactory, http_daemon: dict[str, Any], state: str, lane: str
) -> None:
    # Four daemon states, four verdicts on the one field the panel reads back.
    # A route answering the refusal HQPTuner already held cannot tell the last
    # state from the second: the pair the daemon never saw was the rejected one.
    client = app_factory()
    if state == "daemon_refuses_the_pair":
        http_daemon["_refuse_auth"] = True
    if state == "daemon_gone":
        http_daemon["_take_lane_down"]()
    pair = {"username": "", "password": ""} if state == "incomplete_pair" else {"username": "u", "password": "p"}
    body: dict[str, Any] = {"host": "127.0.0.1", "remember": False, **pair}
    assert client.post("/api/connection", json=body).json().get("lane") == lane
