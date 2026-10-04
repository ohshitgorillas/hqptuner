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
from dataclasses import replace
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import advance_app, app_manager, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from httpx import Response
from narrow import FixtureError
from virtual_clock import VirtualClock

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

    ``poll_interval`` is the caller's: a case that must be the only traffic on
    the lane parks the background poll out past itself; the rest keep the
    production pacing and advance the clock through the cycles they need."""
    daemons: list[Iterator[int]] = []
    https: list[Iterator[dict[str, Any]]] = []
    apps: list[TestClient] = []

    def build(poll_interval: float | None = None, **overrides: object) -> tuple[TestClient, dict[str, Any]]:
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
            backup_dir=area / "backups",
            preset_dir=area / "presets",
            live_preset_file=area / "live-presets.json",
            favorites_file=area / "favorites.json",
            narrowing_file=area / "narrowing.json",
            description_file=area / "descriptions.json",
            matrix_mode_file=area / "matrixmodes.json",
            autopilot_file=area / "autopilot.json",
        )
        if poll_interval is not None:
            cfg = replace(cfg, poll_interval=poll_interval)
        client = TestClient(create_app(cfg, VirtualClock()))
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


def _settle(client: TestClient, state: dict[str, Any], cycles: int = 2, polls: int = 20) -> None:
    """Advance the app's clock one poll interval at a time until the 8088 lane
    has taken `cycles` more poll cycles' worth of arrivals, so whatever the
    daemon was just told to answer has been read and recorded.

    Two cycles is the smallest settle that cannot land inside the cycle it is
    waiting on, and the poll bound only turns a lane that stopped polling into
    a loud failure."""
    target = state["_requests"] + cycles * _PER_CYCLE
    interval = app_manager(client).cfg.poll_interval
    for _ in range(polls):
        if state["_requests"] >= target:
            return
        advance_app(client, interval)
    raise FixtureError(reason="the 8088 lane took no further polls")


def _loaded(client: TestClient) -> None:
    """Return once the app's startup load has finished: `ready` says the app has
    loaded what a caller reads off it, and the settle `wait_for_api` starts with
    leaves no load in flight, so no archive read of its own is still arriving.

    `reachable` is the 4321 handshake, which turns true before the 8088 lane's
    loads have run, so a case that counts archive fetches off its own request
    has to wait for `ready`."""
    wait_for_api(client, lambda c: bool(c.get("/api/health").json()["ready"]))


def _require_recorded_refusal(client: TestClient) -> None:
    """Stop the test unless the lane has already recorded the 403.

    That precondition is what separates the two cases below, so a case that
    silently lost it would read as the other one passing."""
    if _credentials_ok(client) is not False:
        raise FixtureError(reason="the lane never recorded the refusal, so the recorded case never set itself up")


#: What `_credentials_ok` reads where health reports no verdict yet: nothing on
#: the 8088 lane has been answered, so the credentials are neither accepted nor refused.
UNREAD = "unread"


def _credentials_ok(client: TestClient) -> bool | str:
    value: bool | None = client.get("/api/health").json().get("credentials_ok")
    return UNREAD if value is None else value


#: The daemon's answers in the order one app meets them, each settled before
#: the next, and the verdict reported once the last has landed.
VERDICTS = [
    pytest.param([], UNREAD, id="unread"),
    pytest.param([("_down", False)], True, id="accepted"),
    pytest.param([("_down", False), ("_refuse_auth", True)], False, id="refused"),
]


@pytest.mark.parametrize(("changes", "verdict"), VERDICTS)
def test_health_credentials_ok_reports_unknown_then_accepted_then_refused(
    credential_client: CredClient, changes: list[tuple[str, bool]], *, verdict: bool | str
) -> None:
    # Three verdicts along one app's history: nothing read yet, a read that
    # succeeded, a read the daemon answered 403. The control lane carries no
    # authentication and is up the whole way through, so a report sourced from
    # reachability cannot tell the last two apart.
    client, state = credential_client(_down=True)
    _connected(client)
    _settle(client, state)
    for key, value in changes:
        state[key] = value
        _settle(client, state)
    assert _credentials_ok(client) == verdict


@pytest.mark.parametrize(
    ("refuse_first", "verdict"),
    [pytest.param(False, True, id="accepted"), pytest.param(True, False, id="refused")],
)
def test_a_recorded_credential_verdict_outlives_the_daemon_going_down(
    credential_client: CredClient, *, refuse_first: bool, verdict: bool
) -> None:
    # A restore restarts the daemon, so the lane answers 503 on every path for a
    # window after every write. That is not a credential verdict: the verdict
    # already recorded must survive it rather than being cleared by the poll
    # that could not ask.
    client, state = credential_client()
    _connected(client)
    _settle(client, state)
    if _credentials_ok(client) is not True:
        raise FixtureError(reason="the lane never accepted the credentials it started with")
    state["_refuse_auth"] = refuse_first
    _settle(client, state)
    state["_down"] = True
    _settle(client, state)
    assert _credentials_ok(client) is verdict


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
    #
    # Both cases wait for the startup load to finish before counting: it reads
    # the same archive, so a count taken while it is still in flight measures
    # its reads as well as the apply's.
    recorded = case == "recorded"
    client, state = credential_client() if recorded else credential_client(poll_interval=30.0)
    _loaded(client)
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


def _apply_refused_mid_pass(credential_client: CredClient) -> tuple[TestClient, Response]:
    """The app and its apply's answer, where the daemon starts refusing the
    credentials after the edit is staged and before the apply runs.

    Nothing on the lane has recorded the refusal yet, so the apply's own fetch
    is what meets it."""
    client, state = credential_client(poll_interval=30.0)
    _loaded(client)
    client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    state["_refuse_auth"] = True
    return client, client.post("/api/config/apply")


def test_a_persistent_apply_refused_for_credentials_keeps_the_staged_edit(
    credential_client: CredClient,
) -> None:
    # `store.clear()`, which would drop the staged edit, runs only after a
    # successful apply, never reached here.
    client, _ = _apply_refused_mid_pass(credential_client)
    assert client.get("/api/config/pending").json()["http"]["title"] == "Renamed"


def test_a_persistent_apply_refused_for_credentials_answers_code_no_credentials(
    credential_client: CredClient,
) -> None:
    # a refusal met mid-pass is a failed request: the route lets `refuse(exc)`
    # answer with the cause's code
    _, resp = _apply_refused_mid_pass(credential_client)
    assert resp.json()["code"] == "no_credentials"
