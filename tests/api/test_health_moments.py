"""The two moments ``GET /api/health`` reports, ``unreachable_since`` and
``connected_at``, read the manager's clock: an app built on a clock fixed at a
given instant reports that instant, in epoch seconds, whatever the wall says."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from apps import settle_app, wait_for_api
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The instant the app's clock answers with: years from any wall clock the
#: suite runs under, so a body carrying it can only have read the clock handed in.
INSTANT = datetime(2041, 3, 9, 14, 7, 23, tzinfo=UTC)


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
