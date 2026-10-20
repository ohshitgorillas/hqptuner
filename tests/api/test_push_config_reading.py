"""When a refresh of the configuration lane's readings reaches a `GET /api/push` subscriber.

The app here runs on both fakes at once, the threaded 4321 daemon and the 8088
daemon, and its heartbeat polls them at a small fraction of the feed's
keepalive interval, so every pass a case runs ends before any keepalive falls
due; a case that outran it stops on a fixture error rather than reading a
keepalive's publication as the refresh's. The 4321 State is never moved, so no
Engine reading wakes the feed either.

Each case moves the 8088 daemon twice, letting the lane take two poll cycles'
worth of arrivals after each move, so each move has been read in full by a
refresh before the next replaces it. A staged edit posted after both moves
ends the read: its `pending` event queues behind anything the refreshes
published. Staging wakes the feed itself, and a feed that publishes on waking
would carry the latest reading out alongside it; the first move, which the
second replaced before that, is the one only a feed publishing at the refresh
carries.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import fake_http
import pytest
from apps import advance_app, app_manager, phase_is_ready, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from narrow import FixtureError
from sse import events, open_stream
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.api.push import KEEPALIVE
from hqptuner.config import Config

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Sequence
    from pathlib import Path

    from sse import SseBlock

FEED = "/api/push"

#: A thirty-second of the keepalive interval: connecting, reaching Ready, and
#: the passes both moves take all fit before the first keepalive deadline.
HEARTBEAT = KEEPALIVE / 32

#: Pages the 8088 lane is read on per poll cycle: /config, /matrix, /speakers.
PAGES_PER_CYCLE = 3

#: Poll cycles' worth of arrivals a move waits for: two is the smallest count
#: that cannot land inside a cycle already under way when the move was made.
CYCLES_PER_MOVE = 2

#: A bound on the passes one move may take; reached only by a lane that stopped polling.
PASSES_PER_MOVE = 12

#: The titles the daemon's /config form serves after each move; the fake starts
#: at `fake_http.state()`'s, which is neither.
FIRST_TITLE = "first-refresh"
SECOND_TITLE = "second-refresh"

#: The restore-lane field and value whose `pending` event ends the read.
END_FIELD = "marker"
END_VALUE = "read-end"


def _read_closed_by(field: str) -> Callable[[Sequence[SseBlock]], bool]:
    """A read's condition: the latest ``pending`` event stages ``field``."""

    def closed(blocks: Sequence[SseBlock]) -> bool:
        pending = events(blocks, "pending")
        http = json.loads(pending[-1].data).get("http") if pending else None
        return isinstance(http, dict) and field in http

    return closed


def _titles_pushed(blocks: Sequence[SseBlock]) -> list[object]:
    """The form's ``title`` value each ``config`` event carried, in the order they arrived."""
    titles: list[object] = []
    for config in events(blocks, "config"):
        body = json.loads(config.data)
        data = body.get("data") if isinstance(body, dict) else None
        fields = data.get("fields") if isinstance(data, dict) else None
        rows = fields if isinstance(fields, list) else []
        titles.extend(row.get("value") for row in rows if isinstance(row, dict) and row.get("name") == "title")
    return titles


def _verdicts_pushed(blocks: Sequence[SseBlock]) -> list[object]:
    """The ``credentials_ok`` each ``health`` event carried, in the order they arrived."""
    verdicts: list[object] = []
    for health in events(blocks, "health"):
        body = json.loads(health.data)
        verdicts.append(body.get("credentials_ok") if isinstance(body, dict) else None)
    return verdicts


def _lane_refreshed(app: TestClient, http: dict[str, Any]) -> None:
    """Advance the app one heartbeat at a time until the 8088 lane has taken
    `CYCLES_PER_MOVE` poll cycles' worth of arrivals. A refused page costs two
    arrivals, the digest challenge and the refusal, so a refusing daemon's cycle
    is counted at twice the pages."""
    legs = 2 if http["_refuse_auth"] else 1
    target = http["_requests"] + CYCLES_PER_MOVE * PAGES_PER_CYCLE * legs
    for _ in range(PASSES_PER_MOVE):
        if http["_requests"] >= target:
            return
        advance_app(app, HEARTBEAT)
    raise FixtureError(reason="the 8088 lane took no further polls")


def _before_any_keepalive(app: TestClient) -> None:
    """Stop the case unless the app's clock still stands short of the first keepalive deadline."""
    if app_manager(app).clock.monotonic() >= KEEPALIVE:
        raise FixtureError(reason="the passes outran the keepalive, which could have carried the move")


def _pushed_across_two_moves(
    app: TestClient, http: dict[str, Any], moves: Sequence[tuple[str, object]]
) -> list[SseBlock]:
    """Every block the feed sent from opening through the read's end, with each
    of ``moves`` made on the 8088 daemon and refreshed in full before the next."""
    with open_stream(app, FEED) as stream:
        stream.until(lambda blocks: bool(events(blocks, "pending")))
        for key, value in moves:
            http[key] = value
            _lane_refreshed(app, http)
        _before_any_keepalive(app)
        app.post("/api/config/stage", json={"http": {END_FIELD: END_VALUE}})
        return stream.until(_read_closed_by(END_FIELD))


@pytest.fixture
def http() -> Iterator[dict[str, Any]]:
    """The fake 8088 daemon's state, served and live: assigning a key moves the daemon."""
    yield from fake_http.spawn(fake_http.state())


@pytest.fixture
def app(tmp_path: Path, http: dict[str, Any]) -> Iterator[TestClient]:
    """A Ready app on both fakes whose heartbeat polls every `HEARTBEAT` seconds of its clock."""
    daemon = spawn_threaded_daemon()
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=next(daemon),
        hqp_http_port=http["_port"],
        hqp_username="u",
        hqp_password="p",
        poll_interval=HEARTBEAT,
        backup_dir=tmp_path / "backups",
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    with TestClient(create_app(cfg, VirtualClock())) as client:
        wait_for_api(client, phase_is_ready)
        yield client
    next(daemon, None)


def test_a_form_value_the_daemon_now_serves_reaches_the_subscriber_on_the_refresh_that_read_it(
    app: TestClient, http: dict[str, Any]
) -> None:
    blocks = _pushed_across_two_moves(app, http, [("title", FIRST_TITLE), ("title", SECOND_TITLE)])
    assert FIRST_TITLE in _titles_pushed(blocks)


def test_a_credential_verdict_reaches_the_subscriber_on_the_refresh_that_read_it(
    app: TestClient, http: dict[str, Any]
) -> None:
    blocks = _pushed_across_two_moves(app, http, [("_refuse_auth", True), ("_refuse_auth", False)])
    assert False in _verdicts_pushed(blocks)
