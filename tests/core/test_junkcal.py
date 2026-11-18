"""Junk-filter calibration capture stamps what it writes with the manager's clock.

Each case builds the app with `junkcal_dir` set, on two fakes: a
threaded control daemon whose `State` reports the engine playing and whose
`Status` carries a 96 kHz source, and a 4322 stream sending a block and a
quarter of one single-channel frame (a `<4I3fI` header, four `f32` levels in
dBFS, then the reals and the imaginaries) and then holding the socket open. The
app paces on a virtual clock whose wall reads answer ``INSTANT``, an instant no
run of the suite happens at, and the case lets ``POLLS`` poll passes go by
before it reads the capture directory.
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import fake_metering
import pytest
from apps import advance_app, app_manager, connection_stands, control_config, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.engine.metering import BLOCK_SECONDS

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

#: The wall-clock instant the manager's clock answers with: years from any day the suite runs on.
INSTANT = datetime(2003, 4, 5, 6, 7, 8, tzinfo=UTC)

SOURCE_RATE = 96_000
SPUR_KHZ = 30.0
TRANSFORM_TIME = BLOCK_SECONDS / 4

#: What `State` reports while the engine is playing.
PLAYING = "2"

#: Frames the fake sends: a block and a quarter, so a block closes.
PAST_A_BLOCK = 5

#: Poll passes the case lets go by: past the 15 s row cadence at the default poll interval.
POLLS = 20


SPUR_FRAME = fake_metering.spur_frame(source_rate=SOURCE_RATE, spur_khz=SPUR_KHZ, transform_time=TRANSFORM_TIME)


@pytest.fixture
def captured(tmp_path: Path) -> Iterator[Path]:
    """The capture directory after ``POLLS`` poll passes of Nx content playing on a clock at ``INSTANT``."""
    capture = tmp_path / "junkcal"
    capture.mkdir()
    daemon = spawn_threaded_daemon({"state": PLAYING, "_metadata": f'<metadata samplerate="{SOURCE_RATE}"/>'})
    stream = fake_metering.spawn(SPUR_FRAME, frames=PAST_A_BLOCK)
    cfg = replace(control_config(next(daemon), tmp_path), hqp_metering_port=next(stream), junkcal_dir=capture)
    with contextlib.ExitStack() as closing:
        client = closing.enter_context(TestClient(create_app(cfg, VirtualClock(now=INSTANT))))
        wait_for_api(client, connection_stands)
        interval = app_manager(client).cfg.poll_interval
        for _ in range(POLLS):
            advance_app(client, interval)
    yield capture
    for fake in (daemon, stream):
        next(fake, None)


def _rows(capture: Path) -> list[dict[str, Any]]:
    """Every row of every file in the capture directory."""
    return [json.loads(line) for path in capture.iterdir() for line in path.read_text().splitlines() if line]


def _digits(text: str) -> str:
    return "".join(filter(str.isdigit, text))


def test_capture_rows_are_stamped_with_the_managers_clock(captured: Path) -> None:
    assert {datetime.fromisoformat(row["timestamp"]) for row in _rows(captured)} == {INSTANT}


def test_capture_period_file_is_named_for_the_managers_clock(captured: Path) -> None:
    assert {_digits(path.name) for path in captured.iterdir()} == {_digits(INSTANT.strftime("%Y%m%dT%H%M%S"))}
