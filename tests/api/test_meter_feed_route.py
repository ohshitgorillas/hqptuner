"""The first event `GET /api/meter/feed` streams, read off the 4322 stream.

Each case builds the app on two fakes: a threaded control daemon whose `State`
reports the engine playing, and a 4322 stream of frames the case packs itself
in the layout of docs/protocol.md section 7. The route is an endless event
stream, so the case speaks ASGI to the app directly, on the app's own loop:
it reads the response until the first complete server-sent event and then
hangs up.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import struct
from typing import TYPE_CHECKING, Any

import fake_metering
import pytest
from conftest import METADATA_MIN, spawn_threaded_daemon
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

BINS = 1025
TRANSFORM_BITS = 16
BANDWIDTH = 22050.0
TRANSFORM_TIME = 1024 / 44100
GAIN = 2.0
VERSION = 1
RESERVED = 0

#: peakMax, peak, rms, rmsMax for one channel, in dBFS.
CHANNEL_LEVELS = (-3.0, -6.0, -20.0, -18.0)
FLOOR_REAL = 1e-3
TONE_REAL = 1.0
TONE_HZ = 3000.0

#: What `State` reports while the engine is playing.
PLAYING = "2"

#: Frames the fake streams per connection: enough that the stream is still
#: flowing whenever the case subscribes.
FRAMES = 100_000

#: A ceiling on each read from the app; only a stream that never sends reaches it.
READ_CEILING = 10.0

PATH = "/api/meter/feed"


def _frame(channels: int) -> bytes:
    reals = [FLOOR_REAL] * BINS
    reals[round(TONE_HZ / (BANDWIDTH / (BINS - 1)))] = TONE_REAL
    imaginaries = [0.0] * BINS
    header = struct.pack("<4I3fI", VERSION, channels, BINS, TRANSFORM_BITS, BANDWIDTH, TRANSFORM_TIME, GAIN, RESERVED)
    channel = struct.pack(f"<4f{BINS}f{BINS}f", *CHANNEL_LEVELS, *reals, *imaginaries)
    return header + channel * channels


def _first_complete_event(text: str) -> tuple[str, str] | None:
    """The (event name, data) of the first dispatched server-sent event in
    ``text``, per the event-stream format: blocks end at a blank line, and a
    block with no data field dispatches nothing."""
    blocks = text.replace("\r\n", "\n").replace("\r", "\n").split("\n\n")
    for block in blocks[:-1]:
        name = "message"
        data: list[str] = []
        for line in block.split("\n"):
            field, _, value = line.partition(":")
            value = value.removeprefix(" ")
            if field == "event":
                name = value
            elif field == "data":
                data.append(value)
        if data:
            return name, "\n".join(data)
    return None


async def _read_first_event(app: Any, state: dict[str, Any]) -> tuple[str, str] | None:
    """GET the feed, read until its first event, hang up; ``None`` where the
    response ends without one."""
    sent: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    hung_up = asyncio.Event()
    requested = False

    async def receive() -> dict[str, Any]:
        nonlocal requested
        if not requested:
            requested = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await hung_up.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        await sent.put(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": PATH,
        "raw_path": PATH.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver"), (b"accept", b"text/event-stream")],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": state,
    }
    task = asyncio.ensure_future(app(scope, receive, send))
    body = ""
    event = None
    try:
        while event is None:
            message = await asyncio.wait_for(sent.get(), timeout=READ_CEILING)
            if message["type"] != "http.response.body":
                continue
            body += bytes(message.get("body", b"")).decode()
            event = _first_complete_event(body)
            if not message.get("more_body", False):
                break
    finally:
        hung_up.set()
        task.cancel()
        with contextlib.suppress(BaseException):
            await task
    return event


def _first_event(client: TestClient) -> tuple[str, Any] | None:
    portal = client.portal
    if portal is None:
        raise RuntimeError("the client is not running its app")
    event = portal.call(_read_first_event, client.app, dict(getattr(client, "app_state", {})))
    if event is None:
        return None
    name, data = event
    return name, (json.loads(data) or {}).get("channels")


@pytest.fixture
def feed_api(tmp_path: Path) -> Iterator[Callable[[int], TestClient]]:
    """Apps reading a 4322 stream of ``channels``-channel frames, torn down in
    step: the clients first, so each app's reader hangs up, then the fakes."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(channels: int) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING})
        stream = fake_metering.spawn(_frame(channels), frames=FRAMES)
        fakes.extend([daemon, stream])
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_metering_port=next(stream),
            metering_enabled=True,
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        return closing.enter_context(TestClient(create_app(cfg)))

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


@pytest.mark.parametrize("channels", [1, 2], ids=["mono", "stereo"])
def test_the_feed_opens_with_the_geometry_of_the_streams_channel_count(
    feed_api: Callable[[int], TestClient], channels: int
) -> None:
    assert _first_event(feed_api(channels)) == ("geometry", channels)
