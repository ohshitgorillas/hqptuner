"""The supervisor loop's Status cadence while the engine plays.

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
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

#: The heartbeat's interval, three Status steps long, so a window of one heartbeat holds two Status-only reads.
POLL = 3.0
#: The Status-only interval.
STEP = 1.0

#: The transport state a playing engine reports (State/Status ``state``).
PLAYING = "2"
STOPPED = "0"
#: A transport state that will not parse as the integer the wire format promises.
UNPARSEABLE = "x"

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
