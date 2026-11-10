"""The gate: which `/api` requests need a login, and what a login is worth (docs/testing.md).

Every case runs against the real app on the fake 8088 daemon. A second app built over the same state directory is
a restart of the first, and the clock each app reads is the one it is built on: no case waits.
"""

import re
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

import pytest
from apps import app_of, log_in, unserved_login
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fixtures_clients import gated_config
from virtual_clock import DEFAULT_INSTANT, VirtualClock

from hqptuner.api.gate import LOGIN_COOKIE, OPEN_PATHS
from hqptuner.core.login import SAVED_LIFETIME, SESSION_LIFETIME

GatedApp = Callable[..., TestClient]

ONE_SECOND = timedelta(seconds=1)


def served_by(client: TestClient, token: str, path: str = "/api/connection") -> int:
    """The status the app answers a client that is not logged in itself but sends ``token`` as its cookie."""
    bare = TestClient(client.app)
    return int(bare.get(path, headers={"Cookie": f"{LOGIN_COOKIE}={token}"}).status_code)


def login_token(client: TestClient, *, remember: bool) -> str:
    """Log a fresh client of the same app in and return the cookie value it earned."""
    fresh = TestClient(client.app)
    log_in(fresh, remember=remember)
    return str(fresh.cookies[LOGIN_COOKIE])


def gated_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every (method, path) under /api the app serves, as its OpenAPI document lists them, each path parameter filled
    by any value. A route added later is listed the moment it is registered."""
    paths: dict[str, dict[str, object]] = app.openapi()["paths"]
    return [
        (method.upper(), re.sub(r"\{[^}]+\}", "x", path))
        for path, methods in paths.items()
        if path.startswith("/api") and path not in OPEN_PATHS
        for method in methods
    ]


def test_the_route_table_the_gate_is_tried_against_holds_the_conditional_audit_router(gated_app: GatedApp) -> None:
    paths = {path for _, path in gated_routes(app_of(gated_app(audit=True)))}
    assert {"/api/audit", "/api/connection", "/api/meter/feed"} <= paths


def test_every_api_route_but_health_and_login_refuses_a_caller_with_no_login(gated_app: GatedApp) -> None:
    client = gated_app(audit=True)
    routes = gated_routes(app_of(client))
    answered = {route: client.request(*route).status_code for route in routes}
    assert answered == dict.fromkeys(routes, 401)


@pytest.mark.parametrize("path", ["/api/nothing-here", "/api", "/api/", "/api/health/", "/api/login/"])
def test_an_api_path_no_route_names_is_refused_not_missing(gated_app: GatedApp, path: str) -> None:
    client = gated_app()
    assert (client.get(path).status_code, client.get("/api/health").status_code) == (401, 200)


def test_a_caller_on_the_loopback_address_is_refused_like_any_other(gated_app: GatedApp) -> None:
    local = TestClient(gated_app().app, client=("127.0.0.1", 50000))
    assert (local.get("/api/connection").status_code, local.get("/api/health").status_code) == (401, 200)


def test_a_refusal_has_the_shared_error_shape(gated_app: GatedApp) -> None:
    refusal = gated_app().get("/api/connection").json()
    assert sorted(refusal) == ["code", "detail"]


def test_a_login_cookie_opens_the_gate(gated_app: GatedApp) -> None:
    client = gated_app()
    token = login_token(client, remember=False)
    assert (served_by(client, token), served_by(client, "")) == (200, 401)


def test_a_cookie_changed_in_any_way_is_refused(gated_app: GatedApp) -> None:
    client = gated_app()
    token = login_token(client, remember=False)
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
    assert (served_by(client, token), served_by(client, tampered)) == (200, 401)


def test_a_cookie_minted_under_another_pair_is_refused(gated_app: GatedApp) -> None:
    client = gated_app()
    login_token(client, remember=True)
    other = gated_app(pair=("admin", "other"))
    foreign = login_token(other, remember=False)
    assert (served_by(client, foreign), served_by(other, foreign)) == (401, 200)


def test_a_cookie_minted_before_a_pair_change_is_refused_after_it(gated_app: GatedApp) -> None:
    client = gated_app()
    before = login_token(client, remember=False)
    changer = log_in(client)
    changer.post("/api/connection", json={"password": "changed"})
    assert (changer.get("/api/connection").status_code, served_by(client, before)) == (200, 401)


def test_a_save_password_login_outlives_a_restart(gated_app: GatedApp) -> None:
    token = login_token(gated_app(), remember=True)
    assert served_by(gated_app(), token) == 200


def test_a_restart_that_leaves_no_password_ends_every_login(
    gated_app: GatedApp, tmp_path: Path, closed_port: int
) -> None:
    token = login_token(gated_app(), remember=True)
    # a restart with no password cannot reach the daemon's 8088 lane, so it starts with neither lane answering
    with unserved_login(gated_config(tmp_path, closed_port, closed_port, pair=("admin", ""))) as restarted:
        assert (served_by(gated_app(), token), served_by(restarted, token)) == (200, 401)


def test_a_log_in_every_time_login_does_not_outlive_a_restart(gated_app: GatedApp) -> None:
    token = login_token(gated_app(), remember=False)
    assert served_by(gated_app(), token) == 401


def test_a_save_password_login_ends_when_the_apps_clock_passes_its_lifetime(gated_app: GatedApp) -> None:
    token = login_token(gated_app(), remember=True)
    inside = gated_app(VirtualClock(now=DEFAULT_INSTANT + SAVED_LIFETIME - ONE_SECOND))
    past = gated_app(VirtualClock(now=DEFAULT_INSTANT + SAVED_LIFETIME + ONE_SECOND))
    assert (served_by(inside, token), served_by(past, token)) == (200, 401)


def test_a_log_in_every_time_login_ends_after_a_day_and_a_save_password_login_does_not(gated_app: GatedApp) -> None:
    first = gated_app()
    saved = login_token(first, remember=True)
    session = login_token(first, remember=False)
    later = gated_app(VirtualClock(now=DEFAULT_INSTANT + SESSION_LIFETIME + ONE_SECOND))
    assert (served_by(later, saved), served_by(later, session)) == (200, 401)
