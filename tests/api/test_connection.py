"""The runtime connection record: which host and password HQPTuner resolves at
startup, and the /api/connection pair that moves them (docs/testing.md).

Every case parks the record file under ``tmp_path``. The Config default points
at the install's own state, and conftest's `_state_never_touches_the_repo`
covers the stores it knows by name, not this one, so the override here is the
only thing between a POST in a test and the running install's credentials.

The 8088 port is the fake daemon's throughout, never the default: a client
rebuilt mid-test dials whatever the config names, and on this host the default
is the production daemon."""

from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord, ConnectionStore, layer_onto_config

#: The keys GET /api/connection answers, sorted. The password it holds is not
#: among them: anything that reaches port 8090 can read this body.
CONNECTION_KEYS = ["has_password", "host", "remember", "username"]

AppFactory = Callable[..., TestClient]


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "connection.json"


@pytest.fixture
def app_factory(
    store_path: Path, closed_port: int, http_daemon: dict[str, Any], tmp_path: Path
) -> Iterator[AppFactory]:
    """The REST app with its record file in tmp and its 8088 lane pointed at the
    fake daemon, so credentials posted mid-run have something faithful to reach.

    Keyword arguments override the Config the app starts on: a case that needs an
    install which already holds credentials passes them here, and the default is
    the install with none."""
    with ExitStack() as stack:

        def build(**overrides: Any) -> TestClient:
            cfg = Config(
                **{
                    "hqp_host": "127.0.0.1",
                    "hqp_control_port": closed_port,
                    "hqp_http_port": http_daemon["_port"],
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


def post_connection(client: TestClient, password: str, *, remember: bool, username: str = "u") -> int:
    """Carry a whole connection to the app the way the first-run screen will, and
    hand back what the route answered."""
    body = {"host": "127.0.0.1", "username": username, "password": password, "remember": remember}
    return client.post("/api/connection", json=body).status_code


@pytest.mark.parametrize(
    ("env_host", "resolved"),
    [(None, "10.0.0.5"), ("192.168.1.9", "192.168.1.9"), ("", "10.0.0.5")],
)
def test_the_host_override_outranks_the_record_only_when_it_carries_a_value(
    monkeypatch: pytest.MonkeyPatch, store_path: Path, env_host: str | None, resolved: str
) -> None:
    ConnectionStore(store_path).write(ConnectionRecord(host="10.0.0.5", username="u", password="p", remember=True))
    monkeypatch.delenv("HQPTUNER_HQP_HOST", raising=False)
    if env_host is not None:
        monkeypatch.setenv("HQPTUNER_HQP_HOST", env_host)
    cfg = Config(connection_file=store_path)
    layer_onto_config(cfg, ConnectionStore(store_path).read())
    assert cfg.hqp_host == resolved


@pytest.mark.parametrize(("remember", "resolved"), [(True, "p"), (False, "")])
def test_the_posted_password_survives_a_restart_only_when_remember_asked_it_to(
    monkeypatch: pytest.MonkeyPatch, app_factory: AppFactory, store_path: Path, resolved: str, *, remember: bool
) -> None:
    post_connection(app_factory(), password="p", remember=remember)
    monkeypatch.delenv("HQPTUNER_HQP_PASSWORD", raising=False)
    monkeypatch.delenv("HQPTUNER_HQP_USERNAME", raising=False)
    restarted = Config(connection_file=store_path)
    layer_onto_config(restarted, ConnectionStore(store_path).read())
    assert restarted.hqp_password == resolved


def test_posted_credentials_open_the_config_route_with_no_restart(app_factory: AppFactory) -> None:
    client = app_factory()
    before = client.get("/api/config").status_code
    post_connection(client, password="p", remember=True)
    assert (before, client.get("/api/config").status_code) == (503, 200)


def test_the_connection_view_reports_whether_a_password_is_held_and_never_the_password(
    app_factory: AppFactory,
) -> None:
    client = app_factory(hqp_username="u", hqp_password="p")
    started = client.get("/api/connection").json()
    post_connection(client, password="", remember=False)
    cleared = client.get("/api/connection").json()
    assert [sorted(started), started["has_password"], sorted(cleared), cleared["has_password"]] == [
        CONNECTION_KEYS,
        True,
        CONNECTION_KEYS,
        False,
    ]
