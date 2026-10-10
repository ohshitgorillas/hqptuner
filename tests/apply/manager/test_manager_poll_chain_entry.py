"""``core.loader.poll`` re-entering a chain while a LIVE filter batch is in flight.

An edit to the chain the engine has not loaded is held, and the poll that sees
the engine enter that chain re-asserts it with a `SetFilter` and reads it back
with `State`. A LIVE batch writes its own `SetFilter` and reads it back the same
way. Each readback verifies its own write only while
no other `SetFilter` reaches the engine between the write and the read, so the
contract asserted here is on the daemon's command log: every `SetFilter` is read
back by a `State` before the next `SetFilter` arrives.

The LIVE batch is started from the daemon's side of the wire, the moment the
daemon receives the re-assert's `SetFilter`, so it is in flight for exactly the
window the contract covers.
"""

import asyncio
import functools
import itertools
from collections.abc import AsyncIterator, Callable

import pytest
from apps import settled
from fake_control import DEFAULTS, serve_shared
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import loader
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.lane import apply_now

#: The engine in ``[source]`` mode with a PCM source playing: the PCM chain is
#: loaded and the SDM chain is dormant (readme §1.7).
PCM_SOURCE = {"mode": "0", "_active_mode": "PCM"}

#: What the source changes to mid-session, entering the SDM chain.
SDM_SOURCE = "SDM (DSD)"

#: An edit to the dormant SDM chain, held while PCM plays: the SDM Nx filter to
#: enum ID 23, sinc-M, list index 1 on the fake's SDM chain.
HELD_SDM_FILTER = {"oversampling": "23"}

#: The LIVE batch racing the re-assert: the SDM Nx filter to enum ID 38,
#: poly-sinc-gauss-long, list index 0 on the fake's SDM chain.
RACING_SDM_FILTER = {"oversampling": "38"}

#: For each of the two `SetFilter` writes, the next `SetFilter` or `State` the
#: daemon received after it: each write read back before the other lands.
EACH_WRITE_READ_BACK_FIRST = ["State", "State"]


class _LandsOnSetFilter(list[tuple[str, dict[str, str]]]):
    """The fake daemon's command log, which starts one LIVE batch the first time
    the daemon receives ``SetFilter`` after being armed, before that
    ``SetFilter`` is answered."""

    def __init__(self) -> None:
        super().__init__()
        self.land: Callable[[], None] | None = None

    def append(self, entry: tuple[str, dict[str, str]]) -> None:
        super().append(entry)
        if entry[0] == "SetFilter" and self.land is not None:
            land, self.land = self.land, None
            land()


#: A manager connected to the fake and idle on its clock, the fake's live State,
#: and the log that lands the batch.
Polled = tuple[ConnectionManager, dict[str, str], _LandsOnSetFilter]


@pytest.fixture
async def polled(clock: VirtualClock) -> AsyncIterator[Polled]:
    state = {**DEFAULTS, **PCM_SOURCE}
    log = _LandsOnSetFilter()
    server = await asyncio.start_server(functools.partial(serve_shared, state=state, log=log), "127.0.0.1", 0)
    port = int(server.sockets[0].getsockname()[1])
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port), clock=clock)
    task = clock.spawn(manager.run())
    await settled(clock)
    yield manager, state, log
    manager.stop()
    await task
    await manager.aclose()
    server.close()
    await server.wait_closed()


def _next_readback_or_write(log: list[tuple[str, dict[str, str]]]) -> list[str]:
    """For each `SetFilter` in ``log``, the name of the next `SetFilter` or
    `State` after it, where one follows."""
    names = [name for name, _attrs in log if name in {"SetFilter", "State"}]
    return [after for name, after in itertools.pairwise(names) if name == "SetFilter"]


async def test_a_live_filter_write_never_lands_between_a_chain_entry_reassert_and_its_readback(
    polled: Polled, clock: VirtualClock
) -> None:
    manager, state, log = polled
    await apply_now(manager, dict(HELD_SDM_FILTER))
    state["_active_mode"] = SDM_SOURCE
    racing: list[asyncio.Task[object]] = []
    log.land = lambda: racing.append(asyncio.ensure_future(apply_now(manager, dict(RACING_SDM_FILTER))))
    await loader.poll(manager)
    await asyncio.gather(*racing)
    await settled(clock)
    assert _next_readback_or_write(log) == EACH_WRITE_READ_BACK_FIRST
