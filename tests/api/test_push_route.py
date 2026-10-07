"""What `GET /api/push` streams: the page's read snapshots, each again only when it changed.

Each case builds a control-only app on a threaded fake daemon whose State
lives in one shared dict, so a case moves the daemon by writing the dict and
lets a poll pass read it by advancing the app's clock one poll interval. The
poll interval is longer than the feed's keepalive interval, so an advance of
the keepalive interval alone runs no poll pass. The stream is endless, so the
case reads it through `sse.open_stream`, a condition at a time.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import fake_control
import pytest
from apps import advance_app, live_app
from conftest import spawn_threaded_daemon
from sse import SseBlock, comments, events, open_stream

from hqptuner.api.push import KEEPALIVE

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Sequence
    from pathlib import Path

    from fastapi.testclient import TestClient
    from sse import SseStream

PATH = "/api/push"

#: Two and a half keepalive intervals: no poll pass lands on a keepalive deadline.
POLL = KEEPALIVE * 2.5

#: The volume the fake's State moves to; it starts at `fake_control.DEFAULTS`'s.
MOVED_VOLUME = "-20.0"

#: A restore-lane field and the value a case stages for it.
FIELD = "title"
STAGED = "pushed"
MARKER = "marker"


def _saw(name: str, count: int = 1) -> Callable[[Sequence[SseBlock]], bool]:
    """A read's condition: ``count`` events named ``name`` have arrived."""
    return lambda blocks: len(events(blocks, name)) >= count


def _staged(field: str) -> Callable[[Sequence[SseBlock]], bool]:
    """A read's condition: a ``pending`` event carries ``field`` in its restore-lane bucket."""
    return lambda blocks: field in _last_http(blocks)


def _commented(blocks: Sequence[SseBlock]) -> bool:
    return bool(comments(blocks))


def _last_body(blocks: Sequence[SseBlock], name: str) -> dict[str, object]:
    """The parsed data of the last event named ``name``, or an empty object where none arrived."""
    found = events(blocks, name)
    body: object = json.loads(found[-1].data) if found else {}
    return body if isinstance(body, dict) else {}


def _last_http(blocks: Sequence[SseBlock]) -> dict[str, str]:
    http = _last_body(blocks, "pending").get("http")
    return http if isinstance(http, dict) else {}


def _last_volume(blocks: Sequence[SseBlock]) -> str | None:
    data = _last_body(blocks, "state").get("data")
    volume = data.get("volume") if isinstance(data, dict) else None
    return volume if isinstance(volume, str) else None


def _first_name(blocks: Sequence[SseBlock]) -> str:
    found = events(blocks)
    return found[0].name if found else ""


@pytest.fixture
def control_state() -> dict[str, str]:
    """The fake daemon's State, shared across its connections."""
    return dict(fake_control.DEFAULTS)


@pytest.fixture
def push_api(tmp_path: Path, control_state: dict[str, str]) -> Iterator[TestClient]:
    """A connected app polling the fake every `POLL` seconds of its clock."""
    daemon = spawn_threaded_daemon(state=control_state)
    app = live_app(next(daemon), tmp_path, poll_interval=POLL)
    yield next(app)
    next(app, None)
    next(daemon, None)


@pytest.fixture
def stream(push_api: TestClient) -> Iterator[SseStream]:
    """The push stream, open on `push_api` and read through its first `pending` event."""
    with open_stream(push_api, PATH) as opened:
        opened.until(_saw("pending"))
        yield opened


def test_the_stream_opens_with_a_health_event(push_api: TestClient) -> None:
    with open_stream(push_api, PATH) as opened:
        blocks = opened.until(lambda read: bool(events(read)))
    assert _first_name(blocks) == "health"


def test_a_fresh_subscriber_receives_the_staged_buffer(push_api: TestClient) -> None:
    push_api.post("/api/config/stage", json={"http": {FIELD: STAGED}})
    with open_stream(push_api, PATH) as opened:
        blocks = opened.until(_saw("pending"))
    assert _last_body(blocks, "pending") == push_api.get("/api/config/pending").json()


def test_a_staged_edit_is_pushed(push_api: TestClient, stream: SseStream) -> None:
    push_api.post("/api/config/stage", json={"http": {FIELD: STAGED}})
    assert _last_http(stream.until(_staged(FIELD))).get(FIELD) == STAGED


def test_a_moved_state_value_is_pushed_after_one_poll_pass(
    push_api: TestClient, stream: SseStream, control_state: dict[str, str]
) -> None:
    control_state["volume"] = MOVED_VOLUME
    advance_app(push_api, POLL)
    assert _last_volume(stream.until(_saw("state", 2))) == MOVED_VOLUME


def test_a_poll_pass_with_nothing_moved_pushes_no_second_state_event(push_api: TestClient, stream: SseStream) -> None:
    advance_app(push_api, POLL)
    # a staged edit after the pass is the read's end: its `pending` event
    # queues behind everything the pass sent
    push_api.post("/api/config/stage", json={"http": {MARKER: STAGED}})
    assert len(events(stream.until(_staged(MARKER)), "state")) == 1


def test_a_quiet_keepalive_interval_writes_a_comment(push_api: TestClient, stream: SseStream) -> None:
    advance_app(push_api, KEEPALIVE)
    assert _commented(stream.until(_commented))
