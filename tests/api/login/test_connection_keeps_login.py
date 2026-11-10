"""A Connection panel save that changes the pair keeps its own browser logged in (docs/testing.md).

The login is bound to the username and password in force, so a save that changes either ends every login made under
the old pair. The browser that saved gets a fresh cookie for the new pair; every other browser has to log in again.
"""

from collections.abc import Callable
from datetime import timedelta

import pytest
from apps import cookie_of, log_in
from fastapi.testclient import TestClient
from virtual_clock import DEFAULT_INSTANT, VirtualClock

from hqptuner.api.gate import LOGIN_COOKIE
from hqptuner.core.login import SAVED_LIFETIME

GatedApp = Callable[..., TestClient]

ONE_SECOND = timedelta(seconds=1)
TEN_DAYS = timedelta(days=10)


def status_with(client: TestClient, token: str) -> int:
    """The status the app answers a client that sends ``token`` as its login cookie and nothing else."""
    bare = TestClient(client.app)
    return int(bare.get("/api/connection", headers={"Cookie": f"{LOGIN_COOKIE}={token}"}).status_code)


def test_a_browser_that_changes_the_password_stays_logged_in(gated_app: GatedApp) -> None:
    client = log_in(gated_app())
    before = client.get("/api/connection").status_code
    client.post("/api/connection", json={"password": "changed"})
    assert (before, client.get("/api/connection").status_code) == (200, 200)


def test_a_browser_logged_in_under_the_old_pair_is_logged_out_by_the_change(gated_app: GatedApp) -> None:
    saver = log_in(gated_app())
    other = log_in(TestClient(saver.app))
    before = other.get("/api/connection").status_code
    saver.post("/api/connection", json={"password": "changed"})
    assert (before, other.get("/api/connection").status_code) == (200, 401)


def test_a_save_that_changes_only_the_host_logs_nobody_out(gated_app: GatedApp) -> None:
    saver = log_in(gated_app())
    other = log_in(TestClient(saver.app))
    saver.post("/api/connection", json={"host": "127.0.0.2"})
    assert (saver.get("/api/connection").status_code, other.get("/api/connection").status_code) == (200, 200)


@pytest.mark.parametrize("save_remembers", [True, False], ids=["save-stores-password", "save-asks-every-time"])
@pytest.mark.parametrize("login_remembers", [True, False], ids=["save-password-login", "session-login"])
def test_the_reissued_cookie_lasts_as_long_as_the_login_it_replaces(
    gated_app: GatedApp, *, login_remembers: bool, save_remembers: bool
) -> None:
    client = log_in(gated_app(), remember=login_remembers)
    saved = client.post("/api/connection", json={"password": "changed", "remember": save_remembers})
    expected = str(int(SAVED_LIFETIME.total_seconds())) if login_remembers else ""
    assert cookie_of(saved)["max-age"] == expected


def test_a_save_does_not_extend_the_login_it_reissues(gated_app: GatedApp) -> None:
    first = gated_app()
    token = log_in(TestClient(first.app), remember=True).cookies[LOGIN_COOKIE]
    saver = gated_app(VirtualClock(now=DEFAULT_INSTANT + TEN_DAYS))
    reissued = cookie_of(
        saver.post(
            "/api/connection",
            json={"password": "changed", "remember": True},
            headers={"Cookie": f"{LOGIN_COOKIE}={token}"},
        )
    ).value
    inside = gated_app(VirtualClock(now=DEFAULT_INSTANT + SAVED_LIFETIME - ONE_SECOND))
    past = gated_app(VirtualClock(now=DEFAULT_INSTANT + SAVED_LIFETIME + ONE_SECOND))
    assert (status_with(inside, reissued), status_with(past, reissued)) == (200, 401)
