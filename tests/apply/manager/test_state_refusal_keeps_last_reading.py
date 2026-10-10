"""A refused `State` query leaves the manager's last good reading of the engine in place.

HQPlayer answers a command it will not serve with `result="Error"` (docs/protocol.md §6), and a refused read is a
complete, correctly paired reply (docs/architecture.md §4.1). It says nothing about the engine's state, so it never
becomes the manager's reading of it: the reading taken before the refusal stands.

The daemon is the support fake, started with the upsampling filter slot at an index the test picked, then told to
refuse every `State` from that point on through its `_error` knob. The claim is the slot's index in
``manager.readings.state`` after the refusal, which only the earlier, good reading could have supplied.
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from apps import advanced, settled
from conftest import DaemonFactory
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

if TYPE_CHECKING:
    import asyncio

#: The `State` attribute the claim reads, and the index the fake engine holds it at before and after the refusal.
HELD_FIELD, HELD_INDEX = "filterNx", "2"

#: The live edit the post-apply case sends: a dither enum ID the fake's PCM shaper list offers.
LIVE_EDIT = {"dither": "5"}

#: A background poll interval no apply's own waits can reach, so the only `State` refresh that case observes is the
#: one the apply itself runs.
DISTANT_POLL = 3600.0

#: A manager connected to a fake daemon whose `State` is pinned at ``HELD_INDEX``, idle on the clock, with that
#: daemon's live State dict; the argument is the background poll interval.
Started = Callable[[float | None], Awaitable[tuple[ConnectionManager, dict[str, str]]]]


@pytest.fixture
async def started(daemon: DaemonFactory, clock: VirtualClock) -> AsyncIterator[Started]:
    runs: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def start(poll_interval: float | None) -> tuple[ConnectionManager, dict[str, str]]:
        port, _log, state = await daemon(**{HELD_FIELD: HELD_INDEX})
        cfg = Config(hqp_host="127.0.0.1", hqp_control_port=port)
        if poll_interval is not None:
            cfg = replace(cfg, poll_interval=poll_interval)
        manager = ConnectionManager(cfg, clock=clock)
        task = clock.spawn(manager.run())
        runs.append((manager, task))
        await settled(clock)
        return manager, state

    yield start
    for manager, task in runs:
        manager.stop()
        await task
        await manager.aclose()


def _refuse_state(state: dict[str, str]) -> None:
    """From here on the fake daemon answers every `State` with `result="Error"`."""
    state["_error"] = "State"


async def test_a_poll_whose_state_query_is_refused_keeps_the_last_good_reading(
    started: Started, clock: VirtualClock
) -> None:
    manager, state = await started(None)
    _refuse_state(state)
    await advanced(clock, manager.cfg.poll_interval)
    reading = manager.readings.state
    assert reading is not None
    assert reading.get(HELD_FIELD) == HELD_INDEX


async def test_a_live_apply_whose_state_refresh_is_refused_keeps_the_last_good_reading(started: Started) -> None:
    manager, state = await started(DISTANT_POLL)
    _refuse_state(state)
    await manager.applyops.apply({}, LIVE_EDIT)
    reading = manager.readings.state
    assert reading is not None
    assert reading.get(HELD_FIELD) == HELD_INDEX
