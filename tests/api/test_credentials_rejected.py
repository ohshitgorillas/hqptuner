"""Rejected hqplayerd management credentials, end to end (docs/testing.md).

The 8088 config lane needs authentication on every page; the 4321 control lane
needs none. So a daemon that refuses the configured password stays *reachable*
throughout while every config read comes back 403 (`fake_http._auth_refusal`,
the wire verified on 6.0.4). These cases run the app on both fakes at once: the
threaded 4321 daemon plus the fake 8088 daemon whose credential verdict the test
moves mid-run.

Poll cycles are counted at the fake rather than waited for on the wall clock
(rule 7): one cycle reads /config among its pages, so `_settle` spinning until
three cycles' worth of arrivals have landed is a fresh /config verdict whatever
the ordering."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: Arrivals at the 8088 lane per poll cycle, measured against the fake: /config,
#: /matrix and /speakers each cycle. Three cycles of them is the settle target.
_PER_CYCLE = 3

CredClient = Callable[..., tuple[TestClient, dict[str, Any]]]


@pytest.fixture
def credential_client(tmp_path: Path) -> Iterator[CredClient]:
    """Build the REST app on both fakes at once, handing back the client and the
    8088 daemon's live state dict — assigning `_refuse_auth` or `_down` on it is
    how a case says the daemon's answer changed with no request from the app.

    ``poll_interval`` is the caller's: a case that needs poll cycles asks for a
    fast one, and a case that must be the only traffic on the lane parks the
    background poll out past itself."""
    daemons: list[Iterator[int]] = []
    https: list[Iterator[dict[str, Any]]] = []
    apps: list[TestClient] = []

    def build(poll_interval: float = 0.02, **overrides: Any) -> tuple[TestClient, dict[str, Any]]:
        daemon = spawn_threaded_daemon()
        daemons.append(daemon)
        http = fake_http.spawn(fake_http.state(**overrides))
        https.append(http)
        state = next(http)
        # Every store this app owns lands under a directory of this client's own
        # inside the test's tmp_path — never the session-wide area conftest's
        # `_state_never_touches_the_repo` hands a bare Config, which outlives the
        # test and is read by everything after it.
        area = tmp_path / f"app{len(apps)}"
        area.mkdir()
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_http_port=state["_port"],
            hqp_username="u",
            hqp_password="p",
            alarm_threshold=1.0,
            poll_interval=poll_interval,
            backup_dir=area / "backups",
            preset_dir=area / "presets",
            live_preset_file=area / "live-presets.json",
            favorites_file=area / "favorites.json",
            narrowing_file=area / "narrowing.json",
            description_file=area / "descriptions.json",
            matrix_mode_file=area / "matrixmodes.json",
            autopilot_file=area / "autopilot.json",
        )
        client = TestClient(create_app(cfg))
        client.__enter__()
        apps.append(client)
        return client, state

    yield build
    for client in apps:
        client.__exit__(None, None, None)
    for http in https:
        next(http, None)
    for daemon in daemons:
        next(daemon, None)


def _connected(client: TestClient) -> None:
    wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))


def _settle(client: TestClient, state: dict[str, Any], cycles: int = 2, passes: int = 1200) -> None:
    """Spin on real requests — never a wall-clock sleep — until the 8088 lane has
    taken `cycles` more poll cycles' worth of arrivals, so whatever the daemon
    was just told to answer has been read and recorded.

    Requests are what let the app's loop run: a spin that issues none advances
    the lane's arrival count by zero however long it turns. Two cycles is the
    smallest settle that cannot land inside the cycle it is waiting on, and the
    pass bound only turns a lane that stopped polling into a loud failure."""
    target = state["_requests"] + cycles * _PER_CYCLE
    for _ in range(passes):
        client.get("/api/health")
        if state["_requests"] >= target:
            return
    pytest.fail("the 8088 lane took no further polls")


def _require_recorded_refusal(client: TestClient) -> None:
    """Stop the test unless the lane has already recorded the 403.

    That precondition is what separates the two cases below, so a case that
    silently lost it would read as the other one passing."""
    if _credentials_ok(client) is not False:
        pytest.fail("the lane never recorded the refusal, so the recorded case never set itself up")


def _credentials_ok(client: TestClient) -> Any:
    return client.get("/api/health").json().get("credentials_ok")


def test_health_credentials_ok_reports_unknown_then_accepted_then_refused(
    credential_client: CredClient,
) -> None:
    # Three verdicts against one app: nothing read yet, a read that succeeded,
    # a read the daemon answered 403. The control lane carries no
    # authentication and is up the whole way through, so a report sourced from
    # reachability cannot tell the last two apart.
    client, state = credential_client(_down=True)
    _connected(client)
    _settle(client, state)
    unread = _credentials_ok(client)
    state["_down"] = False
    _settle(client, state)
    accepted = _credentials_ok(client)
    state["_refuse_auth"] = True
    _settle(client, state)
    refused = _credentials_ok(client)
    assert (unread, accepted, refused) == (None, True, False)


def test_a_credential_refusal_outlives_the_daemon_going_down(
    credential_client: CredClient,
) -> None:
    # A restore restarts the daemon, so the lane answers 503 on every path for a
    # window after every write. That is not a credential verdict: the refusal
    # already recorded must survive it rather than being cleared by the poll
    # that could not ask.
    client, state = credential_client()
    _connected(client)
    _settle(client, state)
    state["_refuse_auth"] = True
    _settle(client, state)
    state["_down"] = True
    _settle(client, state)
    assert _credentials_ok(client) is False


@pytest.mark.parametrize(("case", "fetches"), [("recorded", 0), ("unrecorded", 1)])
def test_a_persistent_apply_fetches_the_archive_once_at_most_when_credentials_are_refused(
    credential_client: CredClient,
    case: str,
    fetches: int,
) -> None:
    # The archive fetch is what says the apply reached the write path: the poll
    # cycle never asks for it. A refusal the lane has already recorded is caught
    # ahead of the path and fetches nothing; one first met inside the apply costs
    # exactly the fetch that met it, not the three passes the retry loop spends
    # on a post-restart transient.
    #
    # The recorded case lets the poll meet the 403 and checks that it did; the
    # unrecorded case parks the poll and stages before the daemon starts
    # refusing, so nothing on the lane has met the 403 when the apply begins.
    recorded = case == "recorded"
    client, state = credential_client(poll_interval=0.02 if recorded else 30.0)
    _connected(client)
    if recorded:
        state["_refuse_auth"] = True
        _settle(client, state)
        _require_recorded_refusal(client)
        client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    else:
        client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
        state["_refuse_auth"] = True
    before = state["_backup_reads"]
    client.post("/api/config/apply")
    assert state["_backup_reads"] - before == fetches
