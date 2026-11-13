"""A live apply reports when the engine stopped playing under it.

The engine goes from playing (`State.state` 2) to stopped (0) or stop requested (3)
when a write takes it down mid-track, and the report says so. Every other pair of
readings is no stop: playing to playing or paused, and any batch that began with the
engine not playing. A command hook on the setter moves the fake daemon's State at the
moment the batch writes it, so the batch's own re-read sees the move.

Everything runs against the stateful fake daemon over a real socket, on the virtual clock.
"""

import asyncio
import functools
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from apps import settled
from fake_control import DEFAULTS, CommandHooks, serve_shared
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.lane import apply_now, apply_preset

STOPPED = "0"
PAUSED = "1"
PLAYING = "2"
STOP_REQUESTED = "3"
SDM_MODULATOR_ID = "3"
PCM_FILTER_ID = "40"

#: A manager connected to a fake daemon already in the given State, that State, and the daemon's command hooks.
Built = tuple[ConnectionManager, dict[str, str], CommandHooks]


@pytest.fixture
async def daemon_playing(clock: VirtualClock) -> AsyncIterator[Callable[[str], Awaitable[Built]]]:
    """Build a manager on an in-loop fake daemon whose `State.state` starts as asked."""
    started: list[tuple[ConnectionManager, asyncio.Task[None], asyncio.Server]] = []

    async def build(playback: str) -> Built:
        state = {**DEFAULTS, "state": playback}
        hooks: CommandHooks = {}
        server = await asyncio.start_server(functools.partial(serve_shared, state=state, hooks=hooks), "127.0.0.1", 0)
        port = int(server.sockets[0].getsockname()[1])
        manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port), clock=clock)
        started.append((manager, clock.spawn(manager.run()), server))
        await settled(clock)
        return manager, state, hooks

    yield build
    for manager, task, server in started:
        manager.stop()
        await task
        await manager.aclose()
        server.close()
        await server.wait_closed()


@pytest.mark.parametrize(
    ("before", "after", "stopped"),
    [
        (PLAYING, STOPPED, True),
        (PLAYING, STOP_REQUESTED, True),
        (PLAYING, PLAYING, False),
        (PLAYING, PAUSED, False),
        (STOPPED, STOPPED, False),
        (PAUSED, STOPPED, False),
        (STOP_REQUESTED, STOPPED, False),
    ],
)
async def test_a_live_batch_reports_a_stop_only_when_it_took_playback_from_playing_to_stopped(
    daemon_playing: Callable[[str], Awaitable[Built]], before: str, after: str, *, stopped: bool
) -> None:
    manager, state, hooks = await daemon_playing(before)
    hooks["SetFilter"] = lambda: state.update(state=after)
    report = await apply_now(manager, {"filter": PCM_FILTER_ID})
    assert report.playback_stopped == stopped


@pytest.mark.parametrize("batch", ["SetMode", "SetShaping"])
async def test_a_preset_reports_a_stop_that_either_of_its_batches_caused(
    daemon_playing: Callable[[str], Awaitable[Built]], batch: str
) -> None:
    manager, state, hooks = await daemon_playing(PLAYING)
    hooks[batch] = lambda: state.update(state=STOPPED)
    report = await apply_preset(manager, {"mode": "sdm", "modulator": SDM_MODULATOR_ID})
    assert report.playback_stopped is True
