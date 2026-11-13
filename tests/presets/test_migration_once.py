"""The import of the daemon's own presets runs once per process, not once per connect.

On first connect the daemon's ``data/cfgs/*.xml`` are imported
into the preset store. A later connect, after the control lane was severed and
came back, finds the daemon holding a profile it gained in between (saved from
hqplayerd's own web UI) and leaves it out of the store. Observed over the preset
route, since the wire is what the user's browser sees."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_control
import fixtures_clients
import pytest
from apps import settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_config_xml import cfg_xml
from fastapi.testclient import TestClient

#: The profile every fake 8088 archive carries under data/cfgs, there at the first connect.
FIRST_CONNECT_PROFILE = "Test"

#: A profile the daemon gains only after the first connect, as a save from its own web UI would add it.
LATER_PROFILE = "Native"

#: The status the preset route serves a preset the store holds with.
HTTP_OK = 200


def _preset_served(client: TestClient, name: str) -> bool:
    status: int = client.get(f"/api/preset/{name}").status_code
    return status == HTTP_OK


@pytest.fixture
def reconnecting_api(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """Both lanes live, the control fake on one shared State so the test can sever
    the open connection; handed over once the first connect has imported the
    daemon's presets."""
    control_state = dict(fake_control.DEFAULTS)
    daemon = spawn_threaded_daemon(state=control_state)
    served = fixtures_clients.app(http_daemon, tmp_path, next(daemon), None)
    client = next(served)
    try:
        wait_for_api(client, lambda c: _preset_served(c, FIRST_CONNECT_PROFILE))
        yield client, control_state
    finally:
        next(served, None)
    next(daemon, None)


def _served_after_a_reconnect(
    reconnecting_api: tuple[TestClient, dict[str, str]], http_daemon: dict[str, Any]
) -> frozenset[str]:
    """Which of the two daemon profiles the preset route serves once the daemon
    has gained the later one and the manager has severed, reconnected and read
    the settings archive again."""
    client, control_state = reconnecting_api
    http_daemon["_saved"][LATER_PROFILE] = cfg_xml(http_daemon)
    reads_before = http_daemon["_backup_reads"]
    # the restart wire: every open control connection is severed on its next use
    control_state["_generation"] = str(int(control_state.get("_generation", "0")) + 1)
    wait_for_api(client, lambda _c: http_daemon["_backup_reads"] > reads_before)
    settle_app(client)
    return frozenset(name for name in (FIRST_CONNECT_PROFILE, LATER_PROFILE) if _preset_served(client, name))


def test_a_reconnect_imports_none_of_the_profiles_the_daemon_gained_after_the_first_connect(
    reconnecting_api: tuple[TestClient, dict[str, str]], http_daemon: dict[str, Any]
) -> None:
    assert _served_after_a_reconnect(reconnecting_api, http_daemon) == {FIRST_CONNECT_PROFILE}
