"""A matrix profile switch names only a profile the daemon lists.

The daemon answers `MatrixSetProfile` for an unknown name with `result="OK"` and then loops its engine at the next
reinit, so its own readback is no evidence; the name is checked against a fresh `MatrixListProfiles` first. The empty
name is `[Default]` and always switches.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import live_app
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from fastapi.testclient import TestClient
from httpx import Response

#: A listed name that holds spaces, as the fake daemon's default profile list has it.
LISTED = "Mch-to-Stereo mixdown"


@pytest.fixture
def logged_live_api(tmp_path: Path) -> Iterator[tuple[TestClient, CommandLog]]:
    """The two-lane app on a fake 4321 daemon whose received commands land in the returned log."""
    log: CommandLog = []
    daemon = spawn_threaded_daemon(log=log)
    app = live_app(next(daemon), tmp_path)
    yield next(app), log
    next(app, None)
    next(daemon, None)


def _switch(client: TestClient, name: str) -> Response:
    resp: Response = client.post("/api/matrix/profile", json={"action": "switch", "name": name})
    return resp


def test_a_profile_the_daemon_does_not_list_is_refused_as_invalid_input(
    logged_live_api: tuple[TestClient, CommandLog],
) -> None:
    client, _log = logged_live_api
    assert _switch(client, "Ghost").json()["code"] == "invalid_input"


def test_a_profile_the_daemon_does_not_list_sends_no_switch_command(
    logged_live_api: tuple[TestClient, CommandLog],
) -> None:
    client, log = logged_live_api
    _switch(client, "Ghost")
    assert "MatrixSetProfile" not in [name for name, _attrs in log]


def test_a_listed_profile_name_with_spaces_becomes_the_active_one(
    logged_live_api: tuple[TestClient, CommandLog],
) -> None:
    client, _log = logged_live_api
    assert _switch(client, LISTED).json() == {"active": LISTED}


def test_the_empty_name_switches_to_default(logged_live_api: tuple[TestClient, CommandLog]) -> None:
    client, _log = logged_live_api
    assert _switch(client, "").status_code == 200
