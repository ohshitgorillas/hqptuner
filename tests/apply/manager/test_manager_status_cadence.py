"""The supervisor loop's Status cadence while the engine plays (docs/testing.md: behavior only, one
assertion, public API only, fakes speak the wire protocol, no wall clock).

Between two heartbeats the manager reads ``Status`` alone, once every ``status_interval``, while the
engine reports playing; the heartbeat itself keeps ``poll_interval``. Each case counts the traffic that
reached the fake daemon, or reads what the manager stored, after advancing the manager's virtual clock.
"""

import asyncio
import functools
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from apps import advanced, settled
from fake_control import DEFAULTS, CommandLog, serve_shared
from narrow import present
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

#: The heartbeat's interval, three Status steps long, so a window of one heartbeat holds two Status-only reads.
POLL = 3.0
#: The Status-only interval.
STEP = 1.0

#: The transport state a playing engine reports (protocol.md, State/Status ``state``).
PLAYING = "2"
STOPPED = "0"
#: A transport state that will not parse as the integer the wire format promises.
UNPARSEABLE = "x"

#: An engine in ``[source]`` mode playing a PCM source: the PCM chain is loaded (readme §1.7).
PCM_SOURCE = {"mode": "0", "_active_mode": "PCM"}
#: What the source changes to while playing, entering the SDM chain without moving ``State.mode``.
SDM_SOURCE = "SDM (DSD)"
#: The filter enum IDs the fake's SDM chain enumerates, in list order.
SDM_FILTER_IDS = ["38", "23", "57"]

#: The volume the fake's engine moves to between heartbeats; it starts at `fake_control.DEFAULTS`'s.
MOVED_VOLUME = "-20.0"

#: A manager connected to the fake and idle on its clock, the fake's recorded traffic, and its live State.
Built = tuple[ConnectionManager, CommandLog, dict[str, str]]
Build = Callable[..., Awaitable[Built]]


@pytest.fixture
async def build(clock: VirtualClock) -> AsyncIterator[Build]:
    """Build managers polling every `POLL` with Status steps of `STEP`, each on its own fake daemon.

    Keyword arguments are the daemon's State overrides beside the transport state.
    """
    started: list[tuple[ConnectionManager, asyncio.Task[None], asyncio.Server]] = []

    async def start(transport: str, **overrides: str) -> Built:
        log: CommandLog = []
        state = {**DEFAULTS, **overrides, "state": transport}
        server = await asyncio.start_server(functools.partial(serve_shared, state=state, log=log), "127.0.0.1", 0)
        port = int(server.sockets[0].getsockname()[1])
        cfg = Config(hqp_host="127.0.0.1", hqp_control_port=port, poll_interval=POLL, status_interval=STEP)
        manager = ConnectionManager(cfg, clock=clock)
        task = clock.spawn(manager.run())
        started.append((manager, task, server))
        await settled(clock)
        return manager, log, state

    yield start
    for manager, task, server in started:
        manager.stop()
        await task
        await manager.aclose()
        server.close()
        await server.wait_closed()


def _count(log: CommandLog, command: str) -> int:
    return sum(1 for name, _attrs in log if name == command)


@pytest.mark.parametrize(
    ("transport", "command", "reads"),
    [(PLAYING, "Status", 3), (STOPPED, "Status", 1), (UNPARSEABLE, "Status", 1), (PLAYING, "State", 1)],
    ids=["status_while_playing", "status_while_stopped", "status_while_state_unparseable", "heartbeat_while_playing"],
)
async def test_one_heartbeat_interval_reads_status_every_step_only_while_playing_and_state_once(
    build: Build, clock: VirtualClock, transport: str, command: str, reads: int
) -> None:
    _manager, log, _state = await build(transport)
    log.clear()
    await advanced(clock, POLL)
    assert _count(log, command) == reads


async def test_a_status_value_that_moved_between_heartbeats_is_stored_one_step_later(
    build: Build, clock: VirtualClock
) -> None:
    manager, _log, state = await build(PLAYING)
    state["volume"] = MOVED_VOLUME
    await advanced(clock, STEP)
    assert present(manager.readings.status).get("volume") == MOVED_VOLUME


async def test_a_status_read_between_heartbeats_raises_the_edge_the_push_stream_waits_on(
    build: Build, clock: VirtualClock
) -> None:
    manager, _log, _state = await build(PLAYING)
    manager.changed.clear()
    await advanced(clock, STEP)
    assert manager.changed.is_set()


async def test_a_chain_change_a_status_read_sees_first_still_leaves_the_entered_chains_filters_by_the_next_heartbeat(
    build: Build, clock: VirtualClock
) -> None:
    manager, _log, state = await build(PLAYING, **PCM_SOURCE)
    state["_active_mode"] = SDM_SOURCE
    await advanced(clock, POLL)
    assert [item.get("value") for item in present(manager.readings.enums).get("filters", [])] == SDM_FILTER_IDS
