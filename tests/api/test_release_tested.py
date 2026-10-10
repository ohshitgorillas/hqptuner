"""/api/health "release_tested": whether the daemon's installed release, the one
the payload carries as "release" from the 8088 /about page, is in the record of
tested releases the configured data directory ships as tested-releases.json.
The app runs on both lanes, the threaded 4321 fake plus the fake 8088 daemon,
against a data directory each case writes its own record into."""

import json
import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import METADATA_MIN, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The DSP engine build the fake 4321 daemon's GetInfo answers with; it is
#: numbered apart from the installed release and is never the one judged.
ENGINE_BUILD = "6.0.4"

#: A release the fake 8088 daemon's /about page reports in the cases that do not
#: care which one it is.
DAEMON_RELEASE = "6.0.2"

RECORD_FILE = "tested-releases.json"

Build = Callable[..., TestClient]


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


def _settled_health(client: TestClient, passes: int = 50) -> dict[str, Any]:
    """The health payload once the app is connected and has had enough request
    round-trips for its best-effort 8088 loads, the release fetch among them,
    to have run."""
    wait_for_api(client, _reachable)
    for _ in range(passes):
        client.get("/api/health")
    payload: dict[str, Any] = client.get("/api/health").json()
    return payload


@pytest.fixture
def tested_client(tmp_path: Path) -> Iterator[Build]:
    """Build the REST app on both fakes with a data directory holding the
    minimal metadata plus ``record`` as the tested-release record; keyword
    arguments are the 8088 daemon's state overrides."""
    daemons: list[Iterator[int]] = []
    https: list[Iterator[dict[str, Any]]] = []
    apps: list[TestClient] = []

    def build(record: list[str], **overrides: object) -> TestClient:
        data_dir = tmp_path / f"data-{len(apps)}"
        shutil.copytree(METADATA_MIN, data_dir)
        (data_dir / RECORD_FILE).write_text(json.dumps(record))
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
            data_dir=data_dir,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
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


#: The release /about reports, the record shipped beside it, and the verdict.
#: Breaks when: the field is missing or constant; the release is matched as a
#: substring or prefix of a recorded string rather than as a whole entry.
MEMBERSHIP = [
    pytest.param("6.0.2", ["6.0.2"], True, id="the-only-entry"),
    pytest.param("6.0.3", ["6.0.2", "6.0.3"], True, id="one-of-several"),
    pytest.param("6.0.2", ["6.0.20"], False, id="a-longer-release-that-starts-with-it"),
]


@pytest.mark.parametrize(("release", "record", "tested"), MEMBERSHIP)
def test_release_tested_says_whether_the_daemons_release_is_an_entry_in_the_record(
    *, tested_client: Build, release: str, record: list[str], tested: bool
) -> None:
    payload = _settled_health(tested_client(record, release=release))
    assert payload.get("release_tested") is tested


#: The record shipped beside a daemon whose /about reports DAEMON_RELEASE while
#: its GetInfo reports ENGINE_BUILD, and the verdict.
#: Breaks when: the verdict judges info.engine instead of the /about release.
ENGINE_OR_RELEASE = [
    pytest.param([DAEMON_RELEASE], True, id="release-recorded"),
    pytest.param([ENGINE_BUILD], False, id="only-engine-build-recorded"),
]


@pytest.mark.parametrize(("record", "tested"), ENGINE_OR_RELEASE)
def test_release_tested_judges_the_about_release_never_the_engine_build(
    *, tested_client: Build, record: list[str], tested: bool
) -> None:
    payload = _settled_health(tested_client(record, release=DAEMON_RELEASE))
    assert payload.get("release_tested") is tested


#: 8088 daemon state overrides, against a record holding both the engine build
#: and the release /about reports when it can be read, and the verdict.
#: Breaks when: an unread release falls back to the engine build, or the empty
#: release is matched as a substring or prefix of a recorded entry.
READABILITY = [
    pytest.param({}, True, id="about-answers"),
    pytest.param({"_fail_paths": ["/about"]}, False, id="about-unreachable"),
    pytest.param({"_about_body": "<html><body><h1>About</h1></body></html>"}, False, id="about-versionless"),
]


@pytest.mark.parametrize(("overrides", "tested"), READABILITY)
def test_release_tested_holds_only_while_the_release_can_be_read(
    *, tested_client: Build, overrides: dict[str, object], tested: bool
) -> None:
    payload = _settled_health(tested_client([ENGINE_BUILD, DAEMON_RELEASE], release=DAEMON_RELEASE, **overrides))
    assert payload.get("release_tested") is tested
