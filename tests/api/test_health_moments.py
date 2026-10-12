"""The two moments ``GET /api/health`` reports, ``unreachable_since`` and
``connected_at``, read the manager's clock: an app built on a clock fixed at a
given instant reports that instant, in epoch seconds, whatever the wall says.

``connected_at`` is the moment the control connection standing now was made: the
heartbeat polls that run over it leave it where it is, and a new connection made
after the old one dropped moves it to the moment of the new one."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

import fake_control
import pytest
from apps import advance_app, app_manager, settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The instant the app's clock answers with: years from any wall clock the
#: suite runs under, so a body carrying it can only have read the clock handed in.
INSTANT = datetime(2041, 3, 9, 14, 7, 23, tzinfo=UTC)

#: Where the wall stands while heartbeat polls run over the new connection.
LATER = datetime(2041, 3, 9, 15, 30, 2, tzinfo=UTC)

#: Where the wall stands when the daemon severs the first connection and the app makes its next one.
RECONNECT_INSTANT = datetime(2041, 3, 9, 16, 44, 51, tzinfo=UTC)

#: How many heartbeat polls run over the new connection before ``connected_at`` is read.
HEARTBEATS = 3


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


@pytest.fixture
def unreachable_app(closed_port: int) -> Iterator[TestClient]:
    """The app on a clock fixed at ``INSTANT``, its control lane at a port nothing serves."""
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port)
    with TestClient(create_app(cfg, VirtualClock(now=INSTANT))) as client:
        settle_app(client)
        yield client


@pytest.fixture
def connected_app(threaded_daemon_port: int) -> Iterator[TestClient]:
    """The app on a clock fixed at ``INSTANT``, connected to the fake control daemon."""
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=threaded_daemon_port, hqp_username="", hqp_password="")
    with TestClient(create_app(cfg, VirtualClock(now=INSTANT))) as client:
        wait_for_api(client, _reachable)
        yield client


def test_unreachable_since_is_the_instant_the_managers_clock_answers(unreachable_app: TestClient) -> None:
    assert unreachable_app.get("/api/health").json()["unreachable_since"] == INSTANT.timestamp()


def test_connected_at_is_the_instant_the_managers_clock_answers(connected_app: TestClient) -> None:
    assert connected_app.get("/api/health").json()["connected_at"] == INSTANT.timestamp()


@dataclass(frozen=True)
class SeverableApp:
    """The app, the wall clock it reads, and the control fake's shared State and command log."""

    client: TestClient
    clock: VirtualClock
    state: dict[str, str]
    log: CommandLog


@pytest.fixture
def severable_app() -> Iterator[SeverableApp]:
    """The app connected at ``INSTANT`` to a control fake on one shared State, so the test can sever the connection."""
    state = dict(fake_control.DEFAULTS)
    log: CommandLog = []
    daemon = spawn_threaded_daemon(state=state, log=log)
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=next(daemon), hqp_username="", hqp_password="")
    clock = VirtualClock(now=INSTANT)
    with TestClient(create_app(cfg, clock)) as client:
        wait_for_api(client, _reachable)
        yield SeverableApp(client, clock, state, log)
    next(daemon, None)


def _connected_at(client: TestClient) -> object:
    return client.get("/api/health").json()["connected_at"]


def _heartbeats(client: TestClient, count: int) -> None:
    """Let ``count`` of the server's heartbeat polls run."""
    interval = app_manager(client).cfg.poll_interval
    for _ in range(count):
        advance_app(client, interval)


def _connected_at_after_a_reconnect(app: SeverableApp) -> object:
    """``connected_at`` once the daemon has severed the first connection while the wall reads
    ``RECONNECT_INSTANT``, the app has made a new one, and heartbeats have run over it at ``LATER``."""
    app.clock.turn_wall_to(RECONNECT_INSTANT)
    served_before = len(app.log)
    # every open control connection is severed on its next use, its command unanswered and unlogged
    app.state["_generation"] = str(int(app.state.get("_generation", "0")) + 1)
    wait_for_api(app.client, lambda _c: len(app.log) > served_before)
    settle_app(app.client)
    app.clock.turn_wall_to(LATER)
    _heartbeats(app.client, HEARTBEATS)
    return _connected_at(app.client)


def test_connected_at_after_a_reconnect_is_the_moment_the_new_connection_was_made(
    severable_app: SeverableApp,
) -> None:
    assert _connected_at_after_a_reconnect(severable_app) == RECONNECT_INSTANT.timestamp()
