"""The first event `GET /api/meter/feed` streams, read off the 4322 stream.

Each case builds the app on two fakes: a threaded control daemon whose `State`
reports the engine playing, and a 4322 stream of frames the case packs itself
in the layout of docs/spec/protocol.md section 7. The route is an endless event
stream, so the case reads it through `sse.open_stream` until the first
complete server-sent event and then hangs up.
"""

from __future__ import annotations

import contextlib
import json
import struct
from typing import TYPE_CHECKING, Protocol

import fake_metering
import pytest
from apps import advance_app, wait_for_api
from conftest import METADATA_MIN, spawn_threaded_daemon
from fastapi.testclient import TestClient
from sse import any_event, events, open_stream
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.metering import IDLE_RECHECK

if TYPE_CHECKING:
    from collections.abc import Iterator
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

PATH = "/api/meter/feed"

#: The (event name, data) a read answers when the response ended before it
#: dispatched an event. No case expects it: its empty name and its data naming
#: no channels fail every comparison a case makes rather than raising out of one.
NO_EVENT: tuple[str, str] = ("", "{}")

#: The channel count read off an event whose data names none.
NO_CHANNELS = 0

STEREO = 2

#: What the feed answers while metering is off.
NO_CONTENT = 204


class FeedApi(Protocol):
    """Builds an app reading a 4322 stream of ``channels``-channel frames, on
    the config flags given."""

    def __call__(self, channels: int, *, advisor_enabled: bool = True, metering_enabled: bool = True) -> TestClient: ...


def _frame(channels: int) -> bytes:
    reals = [FLOOR_REAL] * BINS
    reals[round(TONE_HZ / (BANDWIDTH / (BINS - 1)))] = TONE_REAL
    imaginaries = [0.0] * BINS
    header = struct.pack("<4I3fI", VERSION, channels, BINS, TRANSFORM_BITS, BANDWIDTH, TRANSFORM_TIME, GAIN, RESERVED)
    channel = struct.pack(f"<4f{BINS}f{BINS}f", *CHANNEL_LEVELS, *reals, *imaginaries)
    return header + channel * channels


def _first_event(client: TestClient) -> tuple[str, str]:
    """The (event name, data) of the stream's first event, or ``NO_EVENT``
    where the response ends without one."""
    with open_stream(client, PATH) as stream:
        found = events(stream.until(any_event))
    return NO_EVENT if not found else (found[0].name, found[0].data)


def _first_event_name(client: TestClient) -> str:
    return _first_event(client)[0]


def _first_event_channels(client: TestClient) -> object:
    return json.loads(_first_event(client)[1]).get("channels", NO_CHANNELS)


@pytest.fixture
def feed_api(tmp_path: Path) -> Iterator[FeedApi]:
    """Apps reading a 4322 stream of ``channels``-channel frames, torn down in
    step: the clients first, so each app's reader hangs up, then the fakes."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(channels: int, *, advisor_enabled: bool = True, metering_enabled: bool = True) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING})
        stream = fake_metering.spawn(_frame(channels), frames=FRAMES)
        fakes.extend([daemon, stream])
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_metering_port=next(stream),
            metering_enabled=metering_enabled,
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
            advisor_enabled=advisor_enabled,
        )
        client = closing.enter_context(TestClient(create_app(cfg, VirtualClock())))
        # connected, then one idle recheck of the reader's, which is when it
        # sees the engine playing and dials the stream
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        advance_app(client, IDLE_RECHECK)
        return client

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


@pytest.mark.parametrize("channels", [1, 2], ids=["mono", "stereo"])
def test_the_feed_opens_with_a_geometry_event(feed_api: FeedApi, channels: int) -> None:
    assert _first_event_name(feed_api(channels)) == "geometry"


@pytest.mark.parametrize("channels", [1, 2], ids=["mono", "stereo"])
def test_the_feeds_first_event_carries_the_streams_channel_count(feed_api: FeedApi, channels: int) -> None:
    assert _first_event_channels(feed_api(channels)) == channels


def test_the_feed_opens_with_a_geometry_event_with_the_advisor_off(feed_api: FeedApi) -> None:
    assert _first_event_name(feed_api(STEREO, advisor_enabled=False)) == "geometry"


def test_the_feed_answers_no_content_with_metering_off(feed_api: FeedApi) -> None:
    assert feed_api(STEREO, metering_enabled=False).get(PATH).status_code == NO_CONTENT
