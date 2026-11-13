"""``GET /api/health`` reports ``connected_at``: how long the control connection standing now has stood, in seconds
on the manager's clock since it became Reachable, and ``null`` while no connection stands.

The age grows with the clock while the connection stands, starts again from zero on the next Reachable after a
departure, and is ``null`` once the daemon has gone away."""

from collections.abc import Iterator
from dataclasses import dataclass

import fake_control
import pytest
from apps import advance_app, connection_stands, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import take_lane_down
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: Seconds the clock is advanced while one connection stands.
STOOD_FOR = 7.25

#: Seconds the first connection stands before the daemon severs it.
FIRST_STOOD = 4.5

#: What ``connected_at`` reads as when health carries no such key at all, distinct from ``null``.
ABSENT = "absent"


@dataclass(frozen=True)
class SeverableApp:
    """The app, the virtual clock it runs on, and the control fake's shared State."""

    client: TestClient
    clock: VirtualClock
    state: dict[str, str]


@pytest.fixture
def severable_app() -> Iterator[SeverableApp]:
    """The app connected to a control fake on one shared State, so the test can sever the connection."""
    state = dict(fake_control.DEFAULTS)
    daemon = spawn_threaded_daemon(state=state)
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=next(daemon), hqp_username="", hqp_password="")
    clock = VirtualClock()
    with TestClient(create_app(cfg, clock)) as client:
        wait_for_api(client, connection_stands)
        yield SeverableApp(client, clock, state)
    next(daemon, None)


def _health(client: TestClient) -> dict[str, object]:
    body: dict[str, object] = client.get("/api/health").json()
    return body


def _age(client: TestClient) -> object:
    """``connected_at`` as health serves it, ``ABSENT`` when the key is missing."""
    return _health(client).get("connected_at", ABSENT)


def _age_gained_while_standing(app: SeverableApp) -> float | None:
    """How far ``connected_at`` moved while the clock advanced ``STOOD_FOR`` over one standing connection, or None
    when either reading is not a number."""
    before = _age(app.client)
    advance_app(app.client, STOOD_FOR)
    after = _age(app.client)
    if not isinstance(before, float) or not isinstance(after, float):
        return None
    return after - before


def test_connected_at_grows_with_the_clock_while_the_connection_stands(severable_app: SeverableApp) -> None:
    assert _age_gained_while_standing(severable_app) == pytest.approx(STOOD_FOR)


@dataclass(frozen=True)
class Reconnected:
    """``connected_at`` read once the new connection stands, and the seconds on the clock since the old one was
    severed."""

    age: object
    since_severed: float


def _reconnected(app: SeverableApp) -> Reconnected:
    """Let the first connection stand ``FIRST_STOOD``, sever it, and read health once the app has made a new one."""
    advance_app(app.client, FIRST_STOOD)
    generation = _health(app.client)["generation"]
    severed_at = app.clock.monotonic()
    # every open control connection is severed on its next use, its command unanswered
    app.state["_generation"] = str(int(app.state.get("_generation", "0")) + 1)
    wait_for_api(app.client, lambda c: _health(c)["generation"] != generation and connection_stands(c))
    return Reconnected(_age(app.client), app.clock.monotonic() - severed_at)


def test_connected_at_starts_again_from_zero_at_the_next_reachable_after_a_departure(
    severable_app: SeverableApp,
) -> None:
    reconnected = _reconnected(severable_app)
    assert reconnected.age == pytest.approx(0.0, abs=reconnected.since_severed)


def _null_while_standing_then_gone(app: SeverableApp) -> list[bool]:
    """Whether ``connected_at`` is ``null`` after a connection has stood ``FIRST_STOOD``, then again once the daemon
    has gone away for good."""
    advance_app(app.client, FIRST_STOOD)
    standing = _age(app.client)
    take_lane_down(app.state)
    wait_for_api(app.client, lambda c: not connection_stands(c))
    return [standing is None, _age(app.client) is None]


def test_connected_at_is_null_only_once_no_connection_stands(severable_app: SeverableApp) -> None:
    assert _null_while_standing_then_gone(severable_app) == [False, True]
