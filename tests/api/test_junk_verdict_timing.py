"""When `GET /api/status` first serves a junk verdict, against how much transform time the stream has covered.

Each case builds the app on two fakes: a threaded control daemon whose `State`
reports the engine playing and whose `Status` carries a 96 kHz source, and a
4322 stream sending a fixed number of copies of one single-channel frame (a
`<4I3fI` header, four `f32` levels in dBFS, then the reals and the
imaginaries) and then holding the socket open. The frame's transform carries a
-60 dB floor and one 0 dB bin at ``SPUR_KHZ``, a persistent tone the spur rule
reads, and each frame covers a quarter of ``BLOCK_SECONDS``. A case reads the
recommendation across a bounded number of poll passes, so every frame the fake
sent has been read by the time it concludes there is none.
"""

from __future__ import annotations

import contextlib
import struct
from typing import TYPE_CHECKING

import fake_metering
import pytest
from apps import advance_app, app_manager, wait_for_api
from conftest import METADATA_MIN, spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.metering import BLOCK_SECONDS

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

SOURCE_RATE = 96_000
BANDWIDTH = SOURCE_RATE / 2
BINS = 1025
SPUR_KHZ = 30.0
TRANSFORM_TIME = BLOCK_SECONDS / 4

#: What `State` reports while the engine is playing.
PLAYING = "2"

#: Frames the fake sends: three quarters of a block, and a block and a quarter.
SHORT_OF_A_BLOCK = 3
PAST_A_BLOCK = 5

#: Poll passes a case reads the recommendation across before it concludes there is none.
POLLS = 20


def _spur_frame() -> bytes:
    reals = [1e-3] * BINS
    reals[round(SPUR_KHZ * 1000 * (BINS - 1) / BANDWIDTH)] = 1.0
    header = struct.pack("<4I3fI", 1, 1, BINS, 11, BANDWIDTH, TRANSFORM_TIME, 0.0, 0)
    levels = (-3.0, -6.0, -20.0, -18.0)
    return header + struct.pack(f"<4f{2 * BINS}f", *levels, *reals, *([0.0] * BINS))


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


@pytest.fixture
def streaming(tmp_path: Path) -> Iterator[Callable[[int], TestClient]]:
    """The REST surface on a playing daemon and a 4322 stream of ``frames`` spur frames; torn down clients first,
    so each reader hangs up before the fakes behind it close."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(frames: int) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING, "_metadata": f'<metadata samplerate="{SOURCE_RATE}"/>'})
        stream = fake_metering.spawn(_spur_frame(), frames=frames)
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
            advisor_enabled=True,
        )
        client = closing.enter_context(TestClient(create_app(cfg, VirtualClock())))
        wait_for_api(client, _reachable)
        return client

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


def _served_ceiling(client: TestClient) -> float | None:
    """The ceiling of the first recommendation `/api/status` serves within ``POLLS`` poll passes, or None."""
    interval = app_manager(client).cfg.poll_interval
    for _ in range(POLLS):
        junk = client.get("/api/status").json()["data"]["junk"]
        if junk is not None:
            ceiling: float = junk["ceiling_khz"]
            return ceiling
        advance_app(client, interval)
    return None


@pytest.mark.parametrize(
    ("frames", "ceiling"),
    [(SHORT_OF_A_BLOCK, None), (PAST_A_BLOCK, SPUR_KHZ)],
    ids=["before the block closes", "once a block has closed"],
)
def test_status_serves_a_junk_verdict_only_once_a_block_has_closed(
    streaming: Callable[[int], TestClient], frames: int, ceiling: float | None
) -> None:
    assert _served_ceiling(streaming(frames)) == ceiling
