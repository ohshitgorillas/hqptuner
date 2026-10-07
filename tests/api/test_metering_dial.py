"""When the metering reader dials the 4322 stream, counted at the fake's accept.

Each case builds the app on two fakes: a threaded control daemon whose `State`
reports the engine playing, and a 4322 stream serving one mono frame the case
packs itself (a `<4I3fI` header, four `f32` levels in dBFS, then the reals and
the imaginaries). The engine plays throughout, so what decides whether the
reader holds the socket is who reads it: the advisor, or a subscriber to the
reader's feed. The count is read once the app and the fake are both torn
down, when nothing can dial any more.
"""

from __future__ import annotations

import struct
from typing import TYPE_CHECKING

import fake_metering
import pytest
from apps import advance_app, app_manager, settle_app, wait_for_api
from conftest import METADATA_MIN, spawn_threaded_daemon
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.metering import IDLE_RECHECK

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Callable
    from pathlib import Path

    from hqptuner.engine.meterfeed import MeterFeed

BINS = 1025
BANDWIDTH = 22050.0
TRANSFORM_TIME = 1024 / 44100
HEADER_FIELDS = (1, 1, BINS, 16, BANDWIDTH, TRANSFORM_TIME, 2.0, 0)
LEVELS = (-3.0, -6.0, -20.0, -18.0)
FRAME = struct.pack("<4I3fI", *HEADER_FIELDS) + struct.pack(f"<4f{2 * BINS}f", *LEVELS, *([1e-3] * (2 * BINS)))

#: What `State` reports while the engine is playing.
PLAYING = "2"

#: Idle rechecks the reader gets after the app is reachable, each one a chance to dial.
TICKS = 5


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


def _feed(client: TestClient) -> MeterFeed:
    reader = app_manager(client).metering
    if reader is None:
        raise FixtureError(reason="the app runs no metering reader")
    return reader.feed


def _on_app_loop(client: TestClient, act: Callable[[], object]) -> None:
    """Run ``act`` on the app's own loop, then let everything it woke settle on the clock."""
    portal = client.portal
    if portal is None:
        raise FixtureError(reason="the client is not running its app")
    portal.call(act)
    settle_app(client)


def _idle(client: TestClient) -> None:
    for _ in range(TICKS):
        advance_app(client, IDLE_RECHECK)


def _page_leaves_and_returns(client: TestClient) -> None:
    """A subscriber attaches, the reader rechecks, it detaches, the reader rechecks, and one attaches again."""
    feed = _feed(client)
    queues: list[asyncio.Queue[str]] = []
    _on_app_loop(client, lambda: queues.append(feed.subscribe()))
    _idle(client)
    _on_app_loop(client, lambda: feed.unsubscribe(queues[0]))
    _idle(client)
    _on_app_loop(client, lambda: queues.append(feed.subscribe()))
    _idle(client)


def _dials(tmp_path: Path, *, advisor_enabled: bool, drive: Callable[[TestClient], None] = _idle) -> int:
    """Connections the fake accepted over an app's whole life, the app driven by ``drive`` once reachable."""
    accepted = fake_metering.Accepted()
    daemon = spawn_threaded_daemon({"state": PLAYING})
    stream = fake_metering.spawn(FRAME, frames=1, accepted=accepted)
    try:
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
            advisor_enabled=advisor_enabled,
        )
        with TestClient(create_app(cfg, VirtualClock())) as client:
            wait_for_api(client, _reachable)
            drive(client)
    finally:
        next(stream, None)
        next(daemon, None)
    return accepted.count


@pytest.mark.parametrize(("advisor_enabled", "dials"), [(False, 0), (True, 1)], ids=["advisor off", "advisor on"])
def test_the_reader_dials_a_playing_engine_only_while_something_reads_the_stream(
    tmp_path: Path, *, advisor_enabled: bool, dials: int
) -> None:
    assert _dials(tmp_path, advisor_enabled=advisor_enabled) == dials


@pytest.mark.parametrize(("advisor_enabled", "dials"), [(False, 2), (True, 1)], ids=["advisor off", "advisor on"])
def test_a_feed_subscriber_leaving_and_returning_redials_only_where_the_advisor_is_off(
    tmp_path: Path, *, advisor_enabled: bool, dials: int
) -> None:
    assert _dials(tmp_path, advisor_enabled=advisor_enabled, drive=_page_leaves_and_returns) == dials
