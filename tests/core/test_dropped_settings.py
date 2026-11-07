"""`GET /api/health` lists the settings a restart nobody asked for dropped, and `DELETE /api/health/dropped-settings`
forgets them.

Each case runs the app against the Control API fake on a virtual clock. A setting the engine runs is a value in the
fake's State; a restart is the fake going back to its config file (the held value gone), severing the open connection
and turning away the first dial. The report is what the page reads under `dropped_settings`.

Policy notes:

- Entries are compared by the wire members the page reads: `field`, `value` and `name`.
- A restart HQPTuner asked for goes out through `settle.restart`, the one way a request that restarts the daemon
  leaves, so the app stamps it as its own.
- The app has read the restarted engine once `GET /api/state` answers again: the Engine readings break with the
  connection, and the report is made in the same step that takes the first reading.
"""

import asyncio
from collections.abc import Callable, Iterator
from pathlib import Path

import fake_control
import pytest
from anyio.from_thread import BlockingPortal
from apps import advance_app, app_manager, connection_stands, live_app, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from narrow import FixtureError

from hqptuner.lanes import settle

#: The poll interval the app runs on; every wait below counts passes of it.
POLL = 2.0

HEALTH = "/api/health"
STATE = "/api/state"
DROPPED = "/api/health/dropped-settings"

#: The junk filter the engine runs before the restart: the fake enumerates index 1 as "20k", enum ID 1.
RUNNING = {"filter_junk": "1"}
REPORTED = {"field": "junk_filter", "value": "1", "name": "20k"}

#: What the restarted engine runs: its config file's value for every setting above.
FROM_FILE = {"filter_junk": "0"}

NO_CONTENT = 204
OK = 200


@pytest.fixture
def control_state() -> dict[str, str]:
    """The fake daemon's State, shared across its connections."""
    return dict(fake_control.DEFAULTS)


@pytest.fixture
def api(tmp_path: Path, control_state: dict[str, str]) -> Iterator[TestClient]:
    """A connected app polling the fake every `POLL` seconds of its clock."""
    daemon = spawn_threaded_daemon(state=control_state)
    app = live_app(next(daemon), tmp_path, poll_interval=POLL)
    yield next(app)
    next(app, None)
    next(daemon, None)


def _portal(api: TestClient) -> BlockingPortal:
    """The portal onto the app's event loop."""
    if api.portal is None:
        raise FixtureError(reason="the client is not open")
    return api.portal


def _reads(api: TestClient, settings: dict[str, str]) -> bool:
    """Whether the app's last State reading carries `settings`."""
    answer = api.get(STATE)
    return bool(answer.status_code == OK and settings.items() <= answer.json()["data"].items())


def _run(api: TestClient, control_state: dict[str, str], settings: dict[str, str]) -> None:
    """Put `settings` on the engine and wait for the app to read them."""
    control_state.update(settings)
    wait_for_api(api, lambda client: _reads(client, settings))


def _restarts(control_state: dict[str, str], settings: dict[str, str]) -> None:
    """The engine restarts by itself onto its config file: the open connection is severed and the first dial refused."""
    control_state.update(settings)
    control_state["_generation"] = str(int(control_state.get("_generation", "0")) + 1)
    control_state["_refuse_connects"] = "1"


def _restart(api: TestClient, control_state: dict[str, str], settings: dict[str, str]) -> None:
    """The engine restarts by itself onto its config file, and the app reads the restarted engine."""
    before = api.get(HEALTH).json()["generation"]
    _restarts(control_state, settings)
    wait_for_api(
        api,
        lambda client: client.get(HEALTH).json()["generation"] > before and _reads(client, settings),
    )


def _retarget(api: TestClient, control_state: dict[str, str], settings: dict[str, str]) -> None:
    """The app is pointed at an engine running `settings`, and reads it."""
    control_state.update(settings)
    _portal(api).call(app_manager(api).retarget)
    wait_for_api(api, lambda client: connection_stands(client) and _reads(client, settings))


def _taken_down(api: TestClient, control_state: dict[str, str], settings: dict[str, str]) -> None:
    """HQPTuner closes its own control socket, and the redial finds an engine running `settings`."""
    control_state.update(settings)
    _portal(api).call(app_manager(api).take_control_down, "test")
    wait_for_api(api, lambda client: connection_stands(client) and _reads(client, settings))


def _dropped(api: TestClient) -> list[dict[str, str]]:
    """The report `GET /api/health` carries."""
    report: list[dict[str, str]] = api.get(HEALTH).json()["dropped_settings"]
    return report


@pytest.mark.parametrize(
    ("restarted_onto", "listed"),
    [pytest.param(FROM_FILE, [REPORTED], id="engine_lost_it"), pytest.param({}, [], id="engine_kept_it")],
)
def test_a_setting_is_listed_only_when_the_restarted_engine_no_longer_runs_it(
    api: TestClient, control_state: dict[str, str], restarted_onto: dict[str, str], listed: list[dict[str, str]]
) -> None:
    _run(api, control_state, RUNNING)
    _restart(api, control_state, restarted_onto)
    assert _dropped(api) == listed


def test_the_report_stays_listed_through_later_poll_passes(api: TestClient, control_state: dict[str, str]) -> None:
    _run(api, control_state, RUNNING)
    _restart(api, control_state, FROM_FILE)
    advance_app(api, POLL)
    assert _dropped(api) == [REPORTED]


@pytest.mark.parametrize(
    ("asked", "listed"), [pytest.param(False, [REPORTED], id="nobody_asked"), pytest.param(True, [], id="asked_for")]
)
def test_only_a_restart_nobody_asked_for_lists_what_it_dropped(
    api: TestClient, control_state: dict[str, str], listed: list[dict[str, str]], *, asked: bool
) -> None:
    async def request() -> None:
        await asyncio.sleep(0)

    _run(api, control_state, RUNNING)
    if asked:
        _portal(api).call(settle.restart, app_manager(api), request)
    _restart(api, control_state, FROM_FILE)
    assert _dropped(api) == listed


def test_clearing_the_report_answers_no_content(api: TestClient, control_state: dict[str, str]) -> None:
    _run(api, control_state, RUNNING)
    _restart(api, control_state, FROM_FILE)
    assert api.delete(DROPPED).status_code == NO_CONTENT


@pytest.mark.parametrize(
    ("cleared", "listed"), [pytest.param(False, [REPORTED], id="left_alone"), pytest.param(True, [], id="cleared")]
)
def test_a_cleared_report_lists_nothing(
    api: TestClient, control_state: dict[str, str], listed: list[dict[str, str]], *, cleared: bool
) -> None:
    _run(api, control_state, RUNNING)
    _restart(api, control_state, FROM_FILE)
    if cleared:
        api.delete(DROPPED)
    assert _dropped(api) == listed


@pytest.mark.parametrize(
    ("move", "listed"),
    [
        pytest.param(_restart, [REPORTED], id="restart"),
        pytest.param(_retarget, [], id="retarget"),
        pytest.param(_taken_down, [], id="taken_down"),
    ],
)
def test_only_a_restart_lists_what_the_engine_read_before_it_is_gone(
    api: TestClient,
    control_state: dict[str, str],
    listed: list[dict[str, str]],
    move: Callable[[TestClient, dict[str, str], dict[str, str]], None],
) -> None:
    # A departure first, so the last one the app saw is a foreign one when the engine changes again.
    _run(api, control_state, {})
    _restart(api, control_state, {})
    _run(api, control_state, RUNNING)
    move(api, control_state, FROM_FILE)
    assert _dropped(api) == listed


def test_a_departure_is_reported_from_the_first_reading_that_carries_state(
    api: TestClient, control_state: dict[str, str]
) -> None:
    _run(api, control_state, RUNNING)
    before = api.get(HEALTH).json()["generation"]
    control_state["_error"] = "State"
    _restarts(control_state, FROM_FILE)
    wait_for_api(api, lambda client: connection_stands(client) and client.get(HEALTH).json()["generation"] > before)
    control_state["_error"] = ""
    wait_for_api(api, lambda client: _reads(client, FROM_FILE))
    assert _dropped(api) == [REPORTED]


def _departed_with_state_refused(api: TestClient, control_state: dict[str, str]) -> None:
    """The engine restarts by itself and the app stands on the new connection, whose State reads are refused."""
    before = api.get(HEALTH).json()["generation"]
    control_state["_error"] = "State"
    _restarts(control_state, FROM_FILE)
    wait_for_api(api, lambda client: connection_stands(client) and client.get(HEALTH).json()["generation"] > before)


def test_a_departure_is_reported_when_another_follows_before_any_reading_carries_state(
    api: TestClient, control_state: dict[str, str]
) -> None:
    _run(api, control_state, RUNNING)
    _departed_with_state_refused(api, control_state)
    _departed_with_state_refused(api, control_state)
    control_state["_error"] = ""
    wait_for_api(api, lambda client: _reads(client, FROM_FILE))
    assert _dropped(api) == [REPORTED]


def test_a_departure_is_reported_when_hqptuner_closes_the_socket_before_any_reading_carries_state(
    api: TestClient, control_state: dict[str, str]
) -> None:
    _run(api, control_state, RUNNING)
    _departed_with_state_refused(api, control_state)
    _portal(api).call(app_manager(api).take_control_down, "test")
    control_state["_error"] = ""
    wait_for_api(api, lambda client: _reads(client, FROM_FILE))
    assert _dropped(api) == [REPORTED]


def test_a_close_of_hqptuners_own_is_a_departure_once_the_next_dial_is_refused(
    api: TestClient, control_state: dict[str, str]
) -> None:
    _run(api, control_state, RUNNING)
    _portal(api).call(app_manager(api).take_control_down, "test")
    _restarts(control_state, FROM_FILE)
    wait_for_api(api, lambda client: _reads(client, FROM_FILE))
    assert _dropped(api) == [REPORTED]
