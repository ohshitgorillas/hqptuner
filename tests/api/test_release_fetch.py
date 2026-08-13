"""/api/health "release" — the daemon's installed release string, parsed from
the 8088 web interface's /about page (the text after the Version heading).
Fetch failure degrades to "" and never affects reachability, so the cases here
run the app on both lanes: the threaded 4321 fake plus the fake 8088 daemon."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


def _settle(client: TestClient, passes: int = 50) -> None:
    """Connected, then enough request round-trips for the app's best-effort
    8088 loads to have run — the release fetch is one of them, and asserting
    on its outcome before it was ever attempted would pass vacuously."""
    wait_for_api(client, _reachable)
    for _ in range(passes):
        client.get("/api/health")


@pytest.fixture
def dual_client(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the REST app on both fakes at once; keyword arguments are the 8088
    daemon's state overrides (``_fail_paths=["/about"]`` refuses that page)."""
    daemons: list[Iterator[int]] = []
    https: list[Iterator[dict[str, Any]]] = []
    apps: list[TestClient] = []

    def build(**overrides: Any) -> TestClient:
        daemon = spawn_threaded_daemon()
        daemons.append(daemon)
        http = fake_http.spawn(fake_http.state(**overrides))
        https.append(http)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_http_port=next(http)["_port"],
            hqp_username="u",
            hqp_password="p",
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        client = TestClient(create_app(cfg))
        client.__enter__()
        apps.append(client)
        return client

    yield build
    for client in apps:
        client.__exit__(None, None, None)
    for http in https:
        next(http, None)
    for daemon in daemons:
        next(daemon, None)


def test_health_release_is_the_daemon_version_from_the_about_page(dual_client: Callable[..., TestClient]) -> None:
    client = dual_client()
    wait_for_api(client, lambda c: c.get("/api/health").json().get("release", "") != "")
    assert client.get("/api/health").json()["release"] == "6.0.2"


def test_release_is_empty_when_the_about_page_is_unreachable(dual_client: Callable[..., TestClient]) -> None:
    client = dual_client(_fail_paths=["/about"])
    _settle(client)
    assert client.get("/api/health").json()["release"] == ""


def test_release_is_empty_when_the_about_page_carries_no_version(dual_client: Callable[..., TestClient]) -> None:
    client = dual_client(_about_body="<html><body><h1>About</h1></body></html>")
    _settle(client)
    assert client.get("/api/health").json()["release"] == ""


def test_daemon_still_reachable_when_the_about_page_is_unreachable(dual_client: Callable[..., TestClient]) -> None:
    client = dual_client(_fail_paths=["/about"])
    _settle(client)
    assert client.get("/api/health").json()["reachable"] is True
