"""The three bar heights `/api/status` serves, read off the 4322 stream.

Each case builds the app on two fakes: a threaded control daemon whose `State`
reports the engine playing, and a 4322 stream of frames the case packs itself.
A frame is a 32-byte little-endian header (`<4I3fI`: version 1, channels,
xformLength 1025, transformBits, bandwidth, transformTime, gain, reserved 0),
then per channel four `f32` levels in dBFS and `2 x xformLength` `f32`
transform values as two consecutive halves, reals then imaginaries, with bin
``k`` at ``k * bandwidth / (xformLength - 1)`` Hz. The frame's power sits in
the bin nearest one tone, and the case reads the low bar back.
"""

from __future__ import annotations

import contextlib
import struct
from typing import TYPE_CHECKING

import fake_metering
import pytest
from conftest import METADATA_MIN, spawn_threaded_daemon, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

BINS = 1025
CHANNELS = 2
TRANSFORM_BITS = 11
BANDWIDTH = 22050.0
TRANSFORM_TIME = 0.1
GAIN = 0.0
VERSION = 1
RESERVED = 0

#: peakMax, peak, rms, rmsMax for one channel, in dBFS.
CHANNEL_LEVELS = (-3.0, -6.0, -20.0, -18.0)

FLOOR_REAL = 1e-3
TONE_REAL = 1.0

#: What `State` reports while the engine is playing, which is the whole window
#: in which the reader holds its 4322 socket.
PLAYING = "2"


def _frame(tone_hz: float) -> bytes:
    """One metering frame whose transform carries the tone in the bin nearest
    ``tone_hz`` and the floor everywhere else."""
    reals = [FLOOR_REAL] * BINS
    reals[round(tone_hz / (BANDWIDTH / (BINS - 1)))] = TONE_REAL
    imaginaries = [0.0] * BINS
    header = struct.pack("<4I3fI", VERSION, CHANNELS, BINS, TRANSFORM_BITS, BANDWIDTH, TRANSFORM_TIME, GAIN, RESERVED)
    channel = struct.pack(f"<4f{BINS}f{BINS}f", *CHANNEL_LEVELS, *reals, *imaginaries)
    return header + channel * CHANNELS


def _bands_served(client: TestClient) -> bool:
    """The app has read enough of the stream to serve the three bar heights."""
    response = client.get("/api/status")
    if response.status_code != 200:
        return False
    return response.json()["data"].get("bands") is not None


@pytest.fixture
def bands_api(tmp_path: Path) -> Iterator[Callable[[float], TestClient]]:
    """Apps reading a 4322 stream of one tone, torn down in step: the clients
    first, so each app's reader hangs up, then the fakes behind them."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(tone_hz: float) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING})
        stream = fake_metering.spawn(_frame(tone_hz))
        fakes.extend([daemon, stream])
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_metering_port=next(stream),
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        client = closing.enter_context(TestClient(create_app(cfg)))
        wait_for_api(client, _bands_served)
        return client

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


def _low_bar(client: TestClient) -> float:
    return float((client.get("/api/status").json()["data"]["bands"] or [])[0])


def test_the_low_bar_stands_higher_on_a_bass_stream(bands_api: Callable[[float], TestClient]) -> None:
    assert _low_bar(bands_api(100.0)) > _low_bar(bands_api(10000.0))
