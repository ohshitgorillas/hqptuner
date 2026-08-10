"""A Control API command the daemon receives and never answers.

Observed on hqplayerd 6.0.4 (2026-07-29, /tmp/hqplayerd.log around 20:11:22): an
output-mode switch took the audio engine down under the daemon, the command was
accepted and logged, no response was ever sent, and the connection was dropped
seconds later. Request/response with no response — so nothing above the socket
can distinguish it from a very slow daemon except by its own deadline, and every
layer has to call it a FAILED COMMAND rather than an internal error.

The fake's `_stall` knob is that daemon: the command is received and logged, the
connection stays open, and nothing comes back (fake_control.DEFAULTS). The
per-command deadline is real wall clock — the virtualized clock in conftest
covers the lanes' own waits only (docs/testing.md §7) — so every fixture here
pins a small `request_timeout` and the cases assert on what came back, never on
how long it took.
"""

import logging
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from conftest import DaemonFactory, _live_app, spawn_threaded_daemon
from fake_control import DEFAULTS
from fastapi.testclient import TestClient

from hqptuner.engine.control import ControlClient, ControlError

#: The per-command deadline these cases wait out, in real seconds. Small because
#: an unanswered command is only observable by the deadline expiring; production
#: default is 5.0 (config.Config.request_timeout).
STALL_TIMEOUT = 0.5

#: The manager's background poll, parked past the end of any case here, so the
#: fake daemon sees traffic from the case's own request and nothing else. The
#: poll shares the one control connection: a poll that trips the same `_stall` or
#: `_close` knob gives up on its deadline and drops that connection, and the
#: request under test then fails "not connected" without ever reaching the fake —
#: the case would be asserting on the poll's failure rather than on the route.
PARKED_POLL_INTERVAL = 3600.0

#: A live setting whose setter is one command with one State attribute behind it
#: (`SetJunkFilter` -> `filter_junk`), so a stalled write has nothing else in the
#: batch to confuse the report with.
STALLED_SETTER = "SetJunkFilter"
STALLED_FIELD = "junk_filter"

#: The setter the field report came from: hqplayerd 6.0.4 accepted `SetMode` and
#: never answered it, because the mode switch took the engine down under it. It is
#: also the setter that swaps the filter/shaper/rate enumerations (protocol.md §6
#: SetMode/GetModes, manual §4.6), so the route re-enumerates after it — a path
#: the `SetJunkFilter` cases never reach. A mode change cannot be batched with
#: other live fields (the route answers 409), so it goes out alone.
STALLED_MODE_SETTER = "SetMode"


@pytest.fixture
async def stalling_client(daemon: DaemonFactory) -> AsyncIterator[ControlClient]:
    """A connected client whose daemon never answers `SetJunkFilter`."""
    port, _, _ = await daemon(_stall=STALLED_SETTER)
    client = ControlClient("127.0.0.1", port, timeout=STALL_TIMEOUT)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture
def stalling_setter_api(tmp_path: Path) -> Iterator[TestClient]:
    """The control-only app on a daemon that never answers `SetJunkFilter`.
    Everything else answers, so the app loads and connects normally."""
    daemon = spawn_threaded_daemon({"_stall": STALLED_SETTER})
    app = _live_app(next(daemon), tmp_path, request_timeout=STALL_TIMEOUT, poll_interval=PARKED_POLL_INTERVAL)
    yield next(app)
    next(app, None)
    next(daemon, None)


@pytest.fixture
def stalling_mode_api(tmp_path: Path) -> Iterator[TestClient]:
    """The control-only app on the daemon from the field report: `SetMode` is
    received and never answered. Every other command answers, so the app loads."""
    daemon = spawn_threaded_daemon({"_stall": STALLED_MODE_SETTER})
    app = _live_app(next(daemon), tmp_path, request_timeout=STALL_TIMEOUT, poll_interval=PARKED_POLL_INTERVAL)
    yield next(app)
    next(app, None)
    next(daemon, None)


@pytest.fixture
def stalling_readback_api(tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """The same app on a daemon that answers the setter and then stops answering
    `State`, with the daemon's own State dict handed back alongside the client.

    The daemon starts healthy so the app can load, and the stall is switched on
    through that shared dict once it has. The dict is also how a case reads the
    daemon's side of the wire without asking it anything — the only way to tell a
    503 raised by the readback from one raised before the setter ever went out."""
    state = dict(DEFAULTS)
    daemon = spawn_threaded_daemon(state=state)
    app = _live_app(next(daemon), tmp_path, request_timeout=STALL_TIMEOUT, poll_interval=PARKED_POLL_INTERVAL)
    client = next(app)
    state["_stall"] = "State"
    yield client, state
    next(app, None)
    next(daemon, None)


# --- the client's own surface -------------------------------------------------


async def test_a_command_the_daemon_never_answers_fails_the_caller(stalling_client: ControlClient) -> None:
    with pytest.raises(ControlError):
        await stalling_client.set_command(STALLED_SETTER, value="1")


async def test_an_unanswered_command_names_itself_in_the_error(stalling_client: ControlClient) -> None:
    # Which command stalled is the whole diagnostic: the daemon logged it and said
    # nothing, so HQPTuner's message is the only place the pairing survives.
    with pytest.raises(ControlError, match=STALLED_SETTER):
        await stalling_client.set_command(STALLED_SETTER, value="1")


# --- the live write route -----------------------------------------------------
# A stalled setter is a failed setting, not a broken server: the route answers
# 200 with that setting reported not ok, the way it does for any setter that did
# not verify. 409 is the engine's lists refusing a field, 422 an unknown field,
# 502 the port-8088 lane, and 500 is never right for a daemon that went quiet.


def test_a_write_whose_setter_stalls_is_still_answered(stalling_setter_api: TestClient) -> None:
    resp = stalling_setter_api.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    assert resp.status_code == 200


def test_a_setter_that_stalls_is_reported_as_not_applied(stalling_setter_api: TestClient) -> None:
    resp = stalling_setter_api.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == STALLED_FIELD)
    assert entry["ok"] is False


def test_a_setter_that_stalls_carries_a_reason(stalling_setter_api: TestClient) -> None:
    resp = stalling_setter_api.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == STALLED_FIELD)
    assert entry.get("error")


def test_a_write_whose_readback_stalls_is_still_answered(
    stalling_readback_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = stalling_readback_api
    resp = client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    assert resp.status_code == 200


def test_a_write_whose_readback_stalls_is_reported_as_not_applied(
    stalling_readback_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = stalling_readback_api
    resp = client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == STALLED_FIELD)
    assert entry["ok"] is False


def test_a_write_whose_readback_stalls_carries_a_reason(
    stalling_readback_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = stalling_readback_api
    resp = client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == STALLED_FIELD)
    assert entry.get("error")


def test_a_write_whose_readback_stalls_still_reached_the_engine(
    stalling_readback_api: tuple[TestClient, dict[str, str]],
) -> None:
    # What makes the two cases above the stalled-READBACK case and not something
    # earlier: the daemon applied the setter, so it was sent and answered, and the
    # silence the route gave up on came after it. A 503 from an app that never
    # connected, or a route that refused before writing, leaves this at "0".
    client, state = stalling_readback_api
    client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    assert state["filter_junk"] == "1"


# --- the setter the field report came from -------------------------------------
# `SetMode` re-enumerates the chain behind it, so its stall is a different path
# through the route than `SetJunkFilter`'s — and it is the one hqplayerd 6.0.4
# actually did this with.


def test_a_mode_write_whose_setter_stalls_is_still_answered(stalling_mode_api: TestClient) -> None:
    resp = stalling_mode_api.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    assert resp.status_code == 200


def test_a_mode_setter_that_stalls_is_reported_as_not_applied(stalling_mode_api: TestClient) -> None:
    resp = stalling_mode_api.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == "mode")
    assert entry["ok"] is False


# --- the connection dropped AFTER the write landed -----------------------------
# The other shape hqplayerd 6.0.4 shows while the engine is down under it, and the
# one actually seen in the field: the setter is answered, its readback verifies,
# and a LATER command dies with the connection. `GetShapers: connection failed:
# Connection lost` on a filter change that had visibly succeeded is what a user
# was shown. Nothing the listener can hear went wrong — the setting is on the
# engine — so the write is a success that lost its housekeeping, not a 503.


#: The post-write housekeeping command the connection dies on. `SetFilter` and
#: `SetMode` swap the enumerations behind them, so the route re-reads the lists
#: after either (protocol.md §6 SetMode/GetModes, manual §4.6) — this is one of
#: those reads, and the one named in the field report.
HOUSEKEEPING_COMMAND = "GetShapers"

#: A live field on the chain the fake has loaded (PCM by default), written by
#: value: enum 40 is `poly-sinc-gauss-long`, index 1 of the fake's PCM list, so
#: `State.filterNx` moving to "1" is the engine's own word that it landed.
CLOSING_FIELD = "filter"
CLOSING_VALUE = "40"
CLOSING_STATE_ATTR = "filterNx"
CLOSING_STATE_VALUE = "1"


def _closing_app(tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """The control-only app on a daemon that answers everything until the app has
    loaded, then drops the connection on `GetShapers` and answers nothing else.

    Healthy first so the app can connect and enumerate; the knob goes on through
    the shared State dict afterwards, which is also how a case reads the daemon's
    side of the wire without asking it anything."""
    state = dict(DEFAULTS)
    daemon = spawn_threaded_daemon(state=state)
    app = _live_app(next(daemon), tmp_path, request_timeout=STALL_TIMEOUT, poll_interval=PARKED_POLL_INTERVAL)
    client = next(app)
    state["_close"] = HOUSEKEEPING_COMMAND
    yield client, state
    next(app, None)
    next(daemon, None)


@pytest.fixture
def closing_api(tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    yield from _closing_app(tmp_path)


@pytest.fixture
def closing_mode_api(tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """The same daemon, for the mode write — which does strictly more housekeeping
    after the setter than any other live field, so it reaches the dropped
    connection by a different path."""
    yield from _closing_app(tmp_path)


def test_a_write_that_loses_the_connection_afterwards_is_still_answered(
    closing_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_api
    resp = client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    assert resp.status_code == 200


def test_a_write_verified_before_the_connection_dropped_is_reported_as_applied(
    closing_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_api
    resp = client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == CLOSING_FIELD)
    assert entry["ok"] is True


def test_a_write_that_loses_the_connection_afterwards_still_reached_the_engine(
    closing_api: tuple[TestClient, dict[str, str]],
) -> None:
    # What makes `ok: true` honest rather than optimistic: a live setting never
    # touches the config file, so the daemon's own State is the only place it
    # shows up, and it shows the new value.
    client, state = closing_api
    client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    assert state[CLOSING_STATE_ATTR] == CLOSING_STATE_VALUE


def test_a_mode_write_that_loses_the_connection_afterwards_is_still_answered(
    closing_mode_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_mode_api
    resp = client.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    assert resp.status_code == 200


def test_a_mode_write_verified_before_the_connection_dropped_is_reported_as_applied(
    closing_mode_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_mode_api
    resp = client.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    entry = next(e for e in resp.json()["live"] if e["setting"] == "mode")
    assert entry["ok"] is True


# The two below assert on a log record, which the testing policy otherwise keeps
# off-limits (docs/testing.md §1). They are here because the operator-visible
# contract for a swallowed failure IS the record: a housekeeping command that
# died is invisible in the 200 the user gets, so the only place it survives is
# the log, and a warning that does not name the command diagnoses nothing.


def test_a_housekeeping_failure_after_a_write_names_the_command_that_failed(
    closing_api: tuple[TestClient, dict[str, str]], caplog: pytest.LogCaptureFixture
) -> None:
    client, _ = closing_api
    with caplog.at_level(logging.WARNING):
        client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    assert any(HOUSEKEEPING_COMMAND in record.getMessage() for record in caplog.records)


def test_a_housekeeping_failure_after_a_write_is_logged_at_warning(
    closing_api: tuple[TestClient, dict[str, str]], caplog: pytest.LogCaptureFixture
) -> None:
    client, _ = closing_api
    with caplog.at_level(logging.WARNING):
        client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    # Only that it is not swallowed silently; which command died is the test above.
    assert any(record.levelno == logging.WARNING for record in caplog.records)


# --- nothing written at all ----------------------------------------------------
# The other side of the line: housekeeping failing after a write landed is a
# success, but a write that never reached a daemon is not. `api_client` points
# the control lane at a port nothing listens on.


def test_a_write_with_no_control_connection_is_unavailable(api_client: TestClient) -> None:
    resp = api_client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    assert resp.status_code == 503
