"""A Control API command the daemon receives and never answers.

Observed on hqplayerd 6.0.4 (2026-07-29, /tmp/hqplayerd.log around 20:11:22): an
output-mode switch took the audio engine down under the daemon, the command was
accepted and logged, no response was ever sent, and the connection was dropped
seconds later. Request/response with no response — so nothing above the socket
can distinguish it from a very slow daemon except by its own deadline, and every
layer has to call it a FAILED COMMAND rather than an internal error.

The fake's `_stall` knob is that daemon: the command is received and logged, the
connection stays open, and nothing comes back (fake_control.DEFAULTS). The
per-command deadline runs on the app's virtual clock.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import live_app
from conftest import spawn_threaded_daemon
from fake_control import DEFAULTS
from fastapi.testclient import TestClient

#: The per-command deadline the app is built with, in virtual seconds. The cases
#: here end on a dropped connection, never on this deadline running out.
STALL_TIMEOUT = 0.5

#: The manager's background poll, parked past the end of any case here, so the
#: fake daemon sees traffic from the case's own request and nothing else. The
#: poll shares the one control connection: a poll that trips the same `_stall` or
#: `_close` knob gives up on its deadline and drops that connection, and the
#: request under test then fails "not connected" without ever reaching the fake —
#: the case would be asserting on the poll's failure rather than on the route.
#: Connecting reads every enumeration once, and the next re-read waits this long
#: on the app's virtual clock, so a knob flipped once the app is up meets the
#: case's request first. The heartbeat between polls reads only State and Status.
PARKED_POLL_INTERVAL = 3600.0

#: A live setting whose setter is one command with one State attribute behind it
#: (`SetJunkFilter` -> `filter_junk`), so a stalled write has nothing else in the
#: batch to confuse the report with.
STALLED_FIELD = "junk_filter"


# --- the connection dropped AFTER the write landed -----------------------------
# The other shape hqplayerd 6.0.4 shows while the engine is down under it, and the
# one actually seen in the field: the setter is answered, its readback verifies,
# and a LATER command dies with the connection. `GetShapers: connection failed:
# Connection lost` on a filter change that had visibly succeeded is what a user
# was shown. Nothing the listener can hear went wrong — the setting is on the
# engine — so the write is a success that lost its housekeeping, not a 503.


#: The post-write housekeeping command the connection dies on. `SetFilter` and
#: `SetMode` swap the enumerations behind them, so the route re-reads the lists
#: after either (manual §4.6) — this is one of those reads, and the one named in
#: the field report.
HOUSEKEEPING_COMMAND = "GetShapers"

#: A live field on the chain the fake has loaded (PCM by default), written by
#: value: enum 40 is `poly-sinc-gauss-long`, index 1 of the fake's PCM list, so
#: `State.filterNx` moving to "1" is the engine's own word that it landed.
CLOSING_FIELD = "filter"
CLOSING_VALUE = "40"


def _closing_app(tmp_path: Path) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """The control-only app on a daemon that answers everything until the app has
    loaded, then drops the connection on `GetShapers` and answers nothing else.

    Healthy first so the app can connect and enumerate; the knob goes on through
    the shared State dict afterwards, which is also how a case reads the daemon's
    side of the wire without asking it anything."""
    state = dict(DEFAULTS)
    daemon = spawn_threaded_daemon(state=state)
    app = live_app(next(daemon), tmp_path, request_timeout=STALL_TIMEOUT, poll_interval=PARKED_POLL_INTERVAL)
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


def test_a_write_verified_before_the_connection_dropped_is_reported_as_applied(
    closing_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_api
    resp = client.post("/api/config/live", json={"fields": {CLOSING_FIELD: CLOSING_VALUE}})
    entry = next(e for e in resp.json()["report"]["live"] if e["setting"] == CLOSING_FIELD)
    assert entry["ok"] is True


def test_a_mode_write_verified_before_the_connection_dropped_is_reported_as_applied(
    closing_mode_api: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = closing_mode_api
    resp = client.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    entry = next(e for e in resp.json()["report"]["live"] if e["setting"] == "mode")
    assert entry["ok"] is True


# --- nothing written at all ----------------------------------------------------
# The other side of the line: housekeeping failing after a write landed is a
# success, but a write that never reached a daemon is not. `api_client` points
# the control lane at a port nothing listens on.


def test_a_write_with_no_control_connection_is_unavailable(api_client: TestClient) -> None:
    resp = api_client.post("/api/config/live", json={"fields": {STALLED_FIELD: "1"}})
    assert resp.status_code == 503
