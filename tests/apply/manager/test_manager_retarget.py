"""Retargeting the connection manager once the configured daemon address has moved.

The control cases run a manager on a fake daemon whose connections are counted from the daemon's side of the wire,
move the configured control port to a second fake, and retarget. The metering case runs the whole app against a
playing engine with the advisor reading the 4322 stream, so the reader holds its socket; it then moves the configured
host and metering port to a second loopback address and counts what the fake there accepted.
"""

import struct
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import fake_metering
from apps import advance_app, advanced, app_manager, connection_stands, settled, wait_for_api
from conftest import METADATA_MIN, spawn_threaded_daemon
from counted_control import CountedDaemon, counted_daemon, still_open
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.metering import IDLE_RECHECK

# --- the control connection ---------------------------------------------------


@asynccontextmanager
async def _running(clock: VirtualClock, daemon: CountedDaemon) -> AsyncIterator[ConnectionManager]:
    """A manager connected to ``daemon`` and idle on ``clock``, stopped at exit."""
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=daemon.port), clock=clock)
    task = clock.spawn(manager.run())
    try:
        await settled(clock)
        if daemon.connections.open != 1:
            raise FixtureError(reason="the manager did not hold one connection to the first daemon")
        yield manager
    finally:
        manager.stop()
        await task
        await manager.aclose()


async def test_retarget_closes_the_control_connection_to_the_address_the_config_no_longer_names(
    clock: VirtualClock,
) -> None:
    async with counted_daemon(clock) as old, counted_daemon(clock) as new, _running(clock, old) as manager:
        manager.cfg.hqp_control_port = new.port
        await manager.retarget()
        await settled(clock)
        assert (await still_open(old.connections), new.connections.open) == (0, 1)


async def test_the_first_dial_after_retarget_reaches_the_new_address_without_waiting_a_poll_interval(
    clock: VirtualClock,
) -> None:
    async with counted_daemon(clock) as old, counted_daemon(clock) as new, _running(clock, old) as manager:
        manager.cfg.hqp_control_port = new.port
        retargeted_at = clock.monotonic()
        await manager.retarget()
        await advanced(clock, manager.cfg.poll_interval)
        assert new.connections.accepted_at == [retargeted_at]


#: Poll intervals given to the manager to stand connected again after the new daemon drops it.
RECOVERY_POLLS = 3


async def test_retarget_closing_the_connection_is_no_departure_where_the_new_daemons_drop_is_one(
    clock: VirtualClock,
) -> None:
    async with counted_daemon(clock) as old, counted_daemon(clock) as new, _running(clock, old) as manager:
        manager.cfg.hqp_control_port = new.port
        await manager.retarget()
        await settled(clock)
        new.state["_generation"] = "1"
        await advanced(clock, RECOVERY_POLLS * manager.cfg.poll_interval)
        assert manager.phase.standing.generation == 1


# --- the metering reader ------------------------------------------------------

#: The two loopback addresses the daemon is reached at, before and after it moves.
OLD_HOST = "127.0.0.1"
NEW_HOST = "127.0.0.2"

BINS = 1025
BANDWIDTH = 22050.0
TRANSFORM_TIME = 1024 / 44100
HEADER_FIELDS = (1, 1, BINS, 16, BANDWIDTH, TRANSFORM_TIME, 2.0, 0)
LEVELS = (-3.0, -6.0, -20.0, -18.0)
FRAME = struct.pack("<4I3fI", *HEADER_FIELDS) + struct.pack(f"<4f{2 * BINS}f", *LEVELS, *([1e-3] * (2 * BINS)))

#: What `State` reports while the engine is playing.
PLAYING = "2"

#: Idle rechecks the reader gets to dial, before the retarget and again after it.
TICKS = 5


def test_retarget_points_the_metering_reader_at_the_configured_host_and_metering_port(tmp_path: Path) -> None:
    accepted = fake_metering.Accepted()
    accepted_before = fake_metering.Accepted()
    old_daemon = spawn_threaded_daemon({"state": PLAYING}, host=OLD_HOST)
    control_port = next(old_daemon)
    new_daemon = spawn_threaded_daemon({"state": PLAYING}, host=NEW_HOST, bind_port=control_port)
    old_stream = fake_metering.spawn(FRAME, frames=1, host=OLD_HOST, accepted=accepted_before)
    new_stream = fake_metering.spawn(FRAME, frames=1, host=NEW_HOST, accepted=accepted)
    try:
        next(new_daemon)
        cfg = Config(
            hqp_host=OLD_HOST,
            hqp_control_port=control_port,
            hqp_metering_port=next(old_stream),
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
            advisor_enabled=True,
        )
        new_metering_port = next(new_stream)
        with TestClient(create_app(cfg, VirtualClock())) as client:
            wait_for_api(client, connection_stands)
            manager = app_manager(client)
            portal = client.portal
            if portal is None:
                raise FixtureError(reason="the test client has no portal into the app's loop")
            for _ in range(TICKS):
                advance_app(client, IDLE_RECHECK)
            manager.cfg.hqp_host = NEW_HOST
            manager.cfg.hqp_metering_port = new_metering_port
            portal.call(manager.retarget)
            for _ in range(TICKS):
                advance_app(client, IDLE_RECHECK)
    finally:
        next(new_stream, None)
        next(old_stream, None)
        next(new_daemon, None)
        next(old_daemon, None)
    if accepted_before.count != 1:
        raise FixtureError(reason="the reader never held the stream at the first address")
    assert accepted.count == 1
