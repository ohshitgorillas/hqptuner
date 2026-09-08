"""The `ready` flag on /api/health (docs/testing.md — behavior only, one
assertion per test, public API only, fakes speak the wire protocol).

`reachable` says the 4321 control connection answered. `ready` says the app has
finished loading what a caller reads off it, which is a LATER moment: `run()`
flags the daemon reachable before the 8088 lane's loads run (conftest's
`settled` says so), and `POST /restore` restarts hqplayerd underneath both lanes
(docs/architecture.md:17) while the 4321 lane never restarts anything itself
(docs/architecture.md:16).
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, StartManager, eventually, settled
from fake_control import serve as fake_serve

from hqptuner.api.routes.status import health
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager


async def _at_the_first_pass_where(condition: Callable[[], bool]) -> None:
    """Come back on the first event-loop pass where the condition holds.

    `eventually` polls at 0.01 s, which is many HTTP round trips against a
    threaded fake — long enough for a load that follows the flag to have
    finished before the flag is read. This yields with no delay instead, so what
    a case reads is the moment the flag turned, not a moment after it."""

    async def spin() -> None:
        while not condition():  # noqa: ASYNC110
            await asyncio.sleep(0)

    await asyncio.wait_for(spin(), timeout=5.0)


# --- the connect body is not instantaneous ----------------------------------


async def test_health_reads_not_ready_at_the_moment_the_daemon_turns_reachable(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    manager = await start_manager(http_daemon["_port"], settle=False)
    await _at_the_first_pass_where(lambda: manager.reachable)
    turned_reachable = health(manager)
    await settled(manager)
    loaded = health(manager)
    assert (turned_reachable["reachable"], turned_reachable["ready"], loaded["reachable"], loaded["ready"]) == (
        True,
        False,
        True,
        True,
    )


# --- `ready` needs BOTH lanes, not the control handshake alone ----------------


async def _after_another_poll(manager: ConnectionManager) -> None:
    """Come back once the manager has been round its poll loop again.

    A lane that goes down between two reads is invisible to a caller until the
    manager has polled since: the first read is the picture it already had.
    Paced on the same public seam `conftest.settled` uses — a completed load —
    never on the wall clock."""
    before = manager.readings.loaded_at
    await eventually(lambda: manager.readings.loaded_at != before, timeout=5.0)


async def test_health_stops_reading_ready_once_the_configuration_lane_goes_down(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    # the 4321 handshake that decides `reachable` is unauthenticated and cannot
    # speak for the Digest-authenticated 8088 lane (docs/architecture.md §2), so
    # a settled install whose configuration lane has since died is an install
    # every persistent write it offers is now impossible on
    manager = await start_manager(http_daemon["_port"])
    with_both_lanes = health(manager)
    http_daemon["_take_lane_down"]()
    await _after_another_poll(manager)
    assert (with_both_lanes["ready"], health(manager)["ready"]) == (True, False)


async def test_health_reads_not_ready_with_no_management_credentials_configured(
    daemon: DaemonFactory, tmp_path: Path
) -> None:
    # nothing built the 8088 lane at all, so the control handshake is the only
    # thing answering — and a lane that is absent has never answered
    port, _log, _state = await daemon()
    manager = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            poll_interval=0.02,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
    )
    task = asyncio.create_task(manager.run())
    try:
        await settled(manager)
        reading = health(manager)
        assert (reading["reachable"], reading["ready"]) == (True, False)
    finally:
        manager.stop()
        await task
        await manager.aclose()


# --- the alarm counts outage time on the same clock it reads ------------------


@pytest.fixture
async def killable_daemon() -> AsyncIterator[tuple[int, Callable[[], Awaitable[None]]]]:
    """The 4321 fake behind a server a test can take down mid-poll: ``kill``
    severs every live connection and closes the listener."""
    writers: list[asyncio.StreamWriter] = []

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writers.append(writer)
        await fake_serve(reader, writer)

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]

    async def kill() -> None:
        server.close()
        for writer in writers:
            writer.close()
        await server.wait_closed()

    yield port, kill
    if server.is_serving():
        await kill()


@pytest.fixture
async def outage_manager(
    killable_daemon: tuple[int, Callable[[], Awaitable[None]]],
) -> AsyncIterator[tuple[ConnectionManager, Callable[[], Awaitable[None]]]]:
    """A manager on the killable fake, reachable, with a one-second alarm
    threshold and a poll loop paced fast enough to notice the kill."""
    port, kill = killable_daemon
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=port, poll_interval=0.02, alarm_threshold=1.0)
    manager = ConnectionManager(cfg)
    task = asyncio.create_task(manager.run())
    await eventually(lambda: manager.reachable)
    yield manager, kill
    manager.stop()
    await task
    await manager.aclose()


async def test_alarm_counts_the_outage_from_the_drop_not_from_construction(
    outage_manager: tuple[ConnectionManager, Callable[[], Awaitable[None]]],
) -> None:
    # fifty seconds of virtual time pass while the daemon is fine; the outage
    # begins at the drop, so the alarm is quiet at that moment and trips only
    # once the threshold has passed from there
    manager, kill = outage_manager
    await manager.sleep(50.0)
    await kill()
    await eventually(lambda: not manager.reachable)
    at_the_drop = manager.alarm
    await manager.sleep(2.0)
    assert (at_the_drop, manager.alarm) == (False, True)
