"""/api/health "release" — the daemon's installed release string, parsed from
the 8088 web interface's /about page (the text after the Version heading).
Fetch failure degrades to "" and never affects reachability, so the cases here
run the app on both lanes: the threaded 4321 fake plus the fake 8088 daemon."""

import contextlib
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from pathlib import Path

import fake_http
import pytest
from apps import log_in, ready_app
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient

from hqptuner.config import Config


@pytest.fixture
def dual_client(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the REST app on both fakes at once; keyword arguments are the 8088
    daemon's state overrides (``_fail_paths=["/about"]`` refuses that page)."""
    with ExitStack() as served:

        def build(**overrides: object) -> TestClient:
            port = served.enter_context(contextlib.contextmanager(spawn_threaded_daemon)())
            spawned = fake_http.state(**overrides)
            http = served.enter_context(contextlib.contextmanager(fake_http.spawn)(spawned, in_process=True))
            cfg = Config(
                hqp_host="127.0.0.1",
                hqp_control_port=port,
                hqp_http_port=http["_port"],
                hqp_username="u",
                hqp_password="p",
                backup_dir=tmp_path,
                preset_dir=tmp_path / "presets",
                live_preset_file=tmp_path / "live-presets.json",
            )
            return log_in(served.enter_context(ready_app(cfg)))

        yield build


#: The 8088 daemon's state overrides and the release /api/health then reports.
ABOUT_PAGES = [
    pytest.param({}, "6.0.2", id="answers"),
    pytest.param({"_fail_paths": ["/about"]}, "", id="unreachable"),
    pytest.param({"_about_body": "<html><body><h1>About</h1></body></html>"}, "", id="versionless"),
]


@pytest.mark.parametrize(("overrides", "release"), ABOUT_PAGES)
def test_release_is_the_about_pages_version_and_empty_when_it_cannot_be_read_or_carries_none(
    dual_client: Callable[..., TestClient], overrides: dict[str, object], release: str
) -> None:
    client = dual_client(**overrides)
    assert client.get("/api/health").json()["release"] == release


def test_daemon_still_reachable_when_the_about_page_is_unreachable(dual_client: Callable[..., TestClient]) -> None:
    client = dual_client(_fail_paths=["/about"])
    assert client.get("/api/health").json()["reachable"] is True
