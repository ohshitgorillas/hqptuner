"""The `ready` flag on /api/health (docs/testing.md — behavior only, one
assertion per test, public API only, fakes speak the wire protocol).

`reachable` says the 4321 control connection answered. `ready` says the app has
finished loading what a caller reads off it, which is a LATER moment: `run()`
flags the daemon reachable before the 8088 lane's loads run (conftest's
`settled` says so), and `POST /restore` restarts hqplayerd underneath both lanes
(docs/architecture.md:17) while the 4321 lane never restarts anything itself
(docs/architecture.md:16). An install with no management credentials has no 8088
lane at all (docs/architecture.md:37), so for it the two moments coincide.

The restart window is modeled on the control fake's own socket rather than on a
knob inside the manager: a daemon that restarts drops every open connection and
refuses new ones until it is back, and that is the whole of what the 4321 side
of a restart looks like from outside. Nothing here waits on the clock — the
window is the fake's behavior, and every assertion is on what the app
concludes, never on how long it took.
"""

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, LiveManager, StartManager, eventually, settled
from fake_control import DEFAULTS, CommandLog, serve
from fake_control import serve as fake_serve

from hqptuner.api.routes.status import health
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

#: How long the fake daemon stays gone after a restore, in seconds of the real
#: clock the fake's own socket runs on. Long enough that a caller returning the
#: moment 8088 answers is unambiguously inside the window; nothing in the suite
#: waits on it, and no assertion reads it.
RESTART_WINDOW = 0.6


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


# --- an install with no 8088 lane has nothing to wait for --------------------


async def test_health_reads_ready_with_no_management_credentials_configured(live_manager: LiveManager) -> None:
    # the fixture's manager is built with no HTTP config client at all, which is
    # what a credential-less install runs as: read-only use and the live
    # settings work without them, and no lane ever loads
    manager, _log, _state = await live_manager()
    assert health(manager)["ready"] is True


# --- a restore takes the control connection with it --------------------------


@pytest.fixture
async def restarting_daemon() -> AsyncIterator[dict[str, Any]]:
    """A 4321 fake that goes away when its ``restart`` is called and comes back
    on its own, the way hqplayerd does on ``POST /restore``: every open
    connection is dropped and every new one is refused until it is back.

    ``restart`` is safe to hand to the 8088 fake's ``_on_restore``, which fires
    on that fake's own handler thread. ``dropped`` counts the connections the
    restart killed, so a case can say the control connection really died rather
    than assuming the hook ran. ``log`` is the fake's command log across every
    connection it served, one ``GetInfo`` per connection, so a case can count
    the connections the manager made rather than trusting a flag."""
    log: CommandLog = []
    box: dict[str, Any] = {"state": {**DEFAULTS}, "down_until": 0.0, "dropped": 0, "log": log}
    live: set[asyncio.StreamWriter] = set()

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if time.monotonic() < box["down_until"]:
            writer.close()  # nothing is listening while the daemon is restarting
            return
        live.add(writer)
        try:
            await serve(reader, writer, state=box["state"], log=log)
        finally:
            live.discard(writer)

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    box["_port"] = int(server.sockets[0].getsockname()[1])
    loop = asyncio.get_running_loop()

    def drop() -> None:
        box["down_until"] = time.monotonic() + RESTART_WINDOW
        box["dropped"] += len(live)
        for writer in list(live):
            writer.close()
        live.clear()

    box["restart"] = lambda: loop.call_soon_threadsafe(drop)
    yield box
    server.close()
    await server.wait_closed()


@pytest.fixture
async def across_a_restart(
    restarting_daemon: dict[str, Any], http_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[ConnectionManager]:
    """A manager on both lanes whose 4321 fake restarts when a restore lands.

    Production poll pacing deliberately, as the other restart suites use: a
    background poll refreshing the picture mid-load is not what these cases are
    about."""
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=restarting_daemon["_port"],
        backup_dir=tmp_path / "backups",
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    manager = ConnectionManager(cfg, http)
    task = asyncio.create_task(manager.run())
    await settled(manager)
    http_daemon["_on_restore"] = restarting_daemon["restart"]
    yield manager
    manager.stop()
    await task
    await manager.aclose()
    await http.aclose()


def _died(restarting_daemon: dict[str, Any]) -> None:
    """The control connection the restore killed, or a failure naming the setup
    that never got there. A restart the manager never felt is the premise of
    this case, not the behavior under test, so it raises rather than spending
    an assertion."""
    if not restarting_daemon["dropped"]:
        raise AssertionError("the restore never dropped a control connection: there was no restart to wait out")


async def _ready_across(manager: ConnectionManager, work: Coroutine[Any, Any, Any]) -> tuple[bool, bool]:
    """What /api/health says about readiness across an awaited call.

    Two observations: whether any event-loop pass INSIDE the call read
    `ready: false`, and what `ready` reads at the moment the call returns. The
    sampler rides the same `asyncio.sleep(0)` idiom `_at_the_first_pass_where`
    does — every pass the call yields on, and no wall-clock wait of its own."""
    samples: list[bool] = []
    running = True

    async def sample() -> None:
        while running:
            samples.append(bool(health(manager)["ready"]))
            await asyncio.sleep(0)

    sampler = asyncio.create_task(sample())
    try:
        await work
    finally:
        running = False
        await sampler
    return (False in samples, bool(health(manager)["ready"]))


async def test_a_preset_load_returns_only_once_health_reads_ready_again(
    across_a_restart: ConnectionManager, restarting_daemon: dict[str, Any]
) -> None:
    await across_a_restart.presetops.save_preset("Stored")
    across_the_load = await _ready_across(across_a_restart, presetlane.load(across_a_restart, "Stored"))
    _died(restarting_daemon)
    assert across_the_load == (True, True)


# --- a restore hands back the control lane on a fresh connection --------------
#
# A restore self-restarts hqplayerd (docs/protocol.md, `POST /restore`), and the
# control connection it held goes with it. What a caller sees at return is
# counted on the control fake's own wire: one `GetInfo` handshake per connection
# (docs/protocol.md, tests/support/fake_control.py), so the number of handshakes
# served is the number of connections the manager made. Production poll pacing
# throughout, so a second handshake inside the call cannot be the poll loop's.


def _handshakes(log: CommandLog) -> int:
    """How many connections the fake has answered a `GetInfo` on."""
    return sum(1 for name, _attrs in log if name == "GetInfo")


async def test_a_preset_save_returns_with_the_control_lane_on_a_fresh_connection(
    daemon: DaemonFactory, http_daemon: dict[str, Any], start_manager: StartManager
) -> None:
    # fakes before the manager, so the manager is torn down while both are
    # still answering
    # the control fake keeps listening through the restore: nothing severs the
    # old connection from outside, so a second handshake at return is the
    # manager's own doing, not a repair of a connection the next poll found dead
    port, log, _state = await daemon()
    manager = await start_manager(http_daemon["_port"], poll_interval=2.0, hqp_control_port=port)
    before = _handshakes(log)
    await manager.presetops.save_preset("Stored")
    assert (before, _handshakes(log)) == (1, 2)


async def test_a_preset_load_returns_on_a_connection_made_after_the_restart(
    across_a_restart: ConnectionManager, restarting_daemon: dict[str, Any]
) -> None:
    # the fake severs every connection on the restore and refuses new ones for
    # a window; the flag the manager held before the restart is not evidence
    # that it came back, a handshake served after the restart is
    await across_a_restart.presetops.save_preset("Stored")
    before = _handshakes(restarting_daemon["log"])
    await presetlane.load(across_a_restart, "Stored")
    _died(restarting_daemon)
    assert _handshakes(restarting_daemon["log"]) == before + 1


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


# --- the configuration lane counts too, but only under a write ----------------
# A refused /config is an ordinary wire fault the polled pass records and rides
# on (tests/apply/test_fault_narrowing.py). What it costs is readiness, and only
# while a write is out: the same refusal with nothing in flight leaves the app
# reporting itself ready.
#
# The in-flight observation is taken at a named pass, not at "some pass inside
# the load": the restart's own control outage reads `ready: false` on every
# implementation, so the moment that tells the lanes apart is AFTER the control
# connection has come back and polled again, with /config still refused. Health's
# `connected_at` is rewritten at the end of every connect and every poll, so it
# is the wire-visible marker for both moments.


async def _the_first_poll_on_the_connection_that_came_back(
    manager: ConnectionManager, restarting_daemon: dict[str, Any], dropped_before: int, connected_before: Any
) -> dict[str, Any]:
    """Health at the first pass where a poll has completed on the control
    connection that came back after the restore's restart: the restart fired
    (`dropped` advanced), the daemon reads reachable again with `connected_at`
    moved off its pre-load value, and then `connected_at` moved once more."""
    await _at_the_first_pass_where(
        lambda: restarting_daemon["dropped"] > dropped_before
        and manager.reachable
        and health(manager)["connected_at"] != connected_before
    )
    came_back_at = health(manager)["connected_at"]
    await _at_the_first_pass_where(lambda: health(manager)["connected_at"] != came_back_at)
    return health(manager)


async def test_a_refusing_configuration_read_costs_readiness_only_under_a_write(
    across_a_restart: ConnectionManager,
    restarting_daemon: dict[str, Any],
    http_daemon: dict[str, Any],
    start_manager: StartManager,
) -> None:
    # the settled half: a manager with nothing in flight, /config refused
    idle = await start_manager(http_daemon["_port"])
    http_daemon["_fail_paths"] = ["/config"]
    await settled(idle)
    with_no_write_in_flight = health(idle)["ready"]
    http_daemon["_fail_paths"] = []

    # the in-flight half: /config refused from the moment the load's restore is
    # posted, which is when the daemon restarts underneath both lanes. The save's
    # own restore restarts it too, so the load waits until the control connection
    # is back and has polled: the restart under observation is the load's own,
    # and `dropped` counts a connection that was live when it landed.
    await across_a_restart.presetops.save_preset("Stored")
    connected_after_save = health(across_a_restart)["connected_at"]
    await _at_the_first_pass_where(
        lambda: across_a_restart.reachable and health(across_a_restart)["connected_at"] != connected_after_save
    )

    def refuse_config_then_restart() -> None:
        http_daemon["_fail_paths"] = ["/config"]
        restarting_daemon["restart"]()

    http_daemon["_on_restore"] = refuse_config_then_restart
    dropped_before = int(restarting_daemon["dropped"])
    connected_before = health(across_a_restart)["connected_at"]
    load = asyncio.create_task(presetlane.load(across_a_restart, "Stored"))
    polled_again = await _the_first_poll_on_the_connection_that_came_back(
        across_a_restart, restarting_daemon, dropped_before, connected_before
    )
    ready_at_that_pass, load_done_at_that_pass = polled_again["ready"], load.done()
    http_daemon["_fail_paths"] = []
    await asyncio.wait_for(load, timeout=5.0)
    assert (ready_at_that_pass, load_done_at_that_pass, with_no_write_in_flight) == (False, False, True)
