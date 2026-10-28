"""/api/health "release" — the daemon's installed release string, parsed from
the 8088 web interface's /about page (the text after the Version heading).
A release that was not read is served as absent and never moves the phase, so the cases here
run the app on both lanes: the threaded 4321 fake plus the fake 8088 daemon."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import phase_is_ready, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _settle(client: TestClient) -> None:
    """Wait for Ready. The loader reads the release before it reads the configuration,
    so a phase that has reached Ready is one where the release fetch was already attempted;
    asserting on its outcome earlier would pass vacuously."""
    wait_for_api(client, phase_is_ready)


@pytest.fixture
def dual_client(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the REST app on both fakes at once; keyword arguments are the 8088
    daemon's state overrides (``_fail_paths=["/about"]`` refuses that page)."""
    daemons: list[Iterator[int]] = []
    https: list[Iterator[dict[str, Any]]] = []
    apps: list[TestClient] = []

    def build(**overrides: object) -> TestClient:
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
        client = TestClient(create_app(cfg, VirtualClock()))
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


#: The release the stock 8088 daemon's about page answers with.
ANSWERED_RELEASE = "6.0.2"

#: 8088 daemon state overrides under which the release is never read: the about page refused, and an about page
#: that answers with no Version heading.
UNREAD_RELEASES = [
    pytest.param({"_fail_paths": ["/about"]}, id="about_page_refused"),
    pytest.param({"_about_body": "<html><body><h1>About</h1></body></html>"}, id="about_page_carries_no_version"),
]


@pytest.mark.parametrize("overrides", UNREAD_RELEASES)
def test_a_release_that_was_not_read_is_served_as_absent(
    dual_client: Callable[..., TestClient], overrides: dict[str, object]
) -> None:
    unread, answering = dual_client(**overrides), dual_client()
    _settle(unread)
    _settle(answering)
    releases = (unread.get("/api/health").json()["release"], answering.get("/api/health").json()["release"])
    assert releases == (None, ANSWERED_RELEASE)
