"""When a reading the heartbeat takes reaches a `GET /api/push` subscriber.

The app here polls its threaded fake daemon at a fraction of the feed's
keepalive interval, so the passes a case runs all end before any keepalive
falls due. The fake's State lives in one shared dict, so the case moves the
daemon by writing the dict before each pass.

The stream is endless, so a read needs an end. A staged edit posted after the
passes is that end: its `pending` event queues behind anything the passes
published. Staging wakes the feed itself, and a feed that publishes on waking
would carry the latest reading out alongside it; a reading the next pass
replaced before that is the one only a feed publishing at the reading carries.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import fake_control
import pytest
from apps import advance_app, live_app
from conftest import spawn_threaded_daemon
from sse import events, open_stream

from hqptuner.api.push import KEEPALIVE

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Sequence
    from pathlib import Path

    from fastapi.testclient import TestClient
    from sse import SseBlock

FEED = "/api/push"

#: An eighth of the keepalive interval: connecting, opening the stream and two
#: more passes all fit before the first keepalive deadline.
HEARTBEAT = KEEPALIVE / 8

#: The volumes the daemon moves to on two successive passes; the fake starts at
#: `fake_control.DEFAULTS`'s, which is neither.
FIRST_READING = "-31.5"
SECOND_READING = "-42.0"

#: The restore-lane field and value whose `pending` event ends the read.
END_FIELD = "title"
END_VALUE = "read-end"


def _read_closed_by(field: str) -> Callable[[Sequence[SseBlock]], bool]:
    """A read's condition: the latest ``pending`` event stages ``field``."""

    def closed(blocks: Sequence[SseBlock]) -> bool:
        pending = events(blocks, "pending")
        http = json.loads(pending[-1].data).get("http") if pending else None
        return isinstance(http, dict) and field in http

    return closed


def _volumes_pushed(blocks: Sequence[SseBlock]) -> list[object]:
    """The ``volume`` each ``state`` event carried, in the order they arrived."""
    volumes: list[object] = []
    for state in events(blocks, "state"):
        body = json.loads(state.data)
        data = body.get("data") if isinstance(body, dict) else None
        volumes.append(data.get("volume") if isinstance(data, dict) else None)
    return volumes


@pytest.fixture
def daemon_state() -> dict[str, str]:
    """The fake daemon's State, one dict shared by every connection to it."""
    return dict(fake_control.DEFAULTS)


@pytest.fixture
def app(tmp_path: Path, daemon_state: dict[str, str]) -> Iterator[TestClient]:
    """A connected app whose heartbeat polls the fake every `HEARTBEAT` seconds of its clock."""
    daemon = spawn_threaded_daemon(state=daemon_state)
    running = live_app(next(daemon), tmp_path, poll_interval=HEARTBEAT)
    yield next(running)
    next(running, None)
    next(daemon, None)


def test_a_state_reading_reaches_the_subscriber_on_the_pass_that_took_it(
    app: TestClient, daemon_state: dict[str, str]
) -> None:
    with open_stream(app, FEED) as stream:
        stream.until(lambda blocks: bool(events(blocks, "pending")))
        for reading in (FIRST_READING, SECOND_READING):
            daemon_state["volume"] = reading
            advance_app(app, HEARTBEAT)
        app.post("/api/config/stage", json={"http": {END_FIELD: END_VALUE}})
        blocks = stream.until(_read_closed_by(END_FIELD))
    assert FIRST_READING in _volumes_pushed(blocks)
