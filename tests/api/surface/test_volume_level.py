"""A volume level that is not a number is refused at ``POST /api/volume``, and no ``Volume`` command goes out."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import live_app
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from fastapi.testclient import TestClient


@pytest.fixture
def logged_live_api(tmp_path: Path) -> Iterator[tuple[TestClient, CommandLog]]:
    """The two-lane app on a fake 4321 daemon whose received commands land in the returned log."""
    log: CommandLog = []
    daemon = spawn_threaded_daemon(log=log)
    app = live_app(next(daemon), tmp_path)
    yield next(app), log
    next(app, None)
    next(daemon, None)


@pytest.mark.parametrize("level", ['-3"/><Stop/', "abc"])
def test_a_level_that_is_not_a_number_is_refused_as_invalid_input(
    logged_live_api: tuple[TestClient, CommandLog], level: str
) -> None:
    client, _log = logged_live_api
    assert client.post("/api/volume", json={"level": level}).json()["code"] == "invalid_input"


@pytest.mark.parametrize("level", ['-3"/><Stop/', "abc"])
def test_a_level_that_is_not_a_number_sends_no_volume_command(
    logged_live_api: tuple[TestClient, CommandLog], level: str
) -> None:
    client, log = logged_live_api
    client.post("/api/volume", json={"level": level})
    assert "Volume" not in [name for name, _attrs in log]
