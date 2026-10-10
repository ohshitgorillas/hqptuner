"""``core.loader.poll`` against a live write that lands while the poll is in flight.

A poll reads ``State`` and then ``Status``. A live write that lands between the
two has already stored the engine's new State in the manager's picture by the
time ``Status`` comes back, so the State the poll read first describes an engine
that no longer exists. The contract asserted here: once the poll returns, the
picture still holds what the live write stored.

The write is landed from the daemon's side of the wire, the moment it receives
``Status``: the fake's own engine moves to the written filter and the manager's
picture is set to the State that write stored, exactly as a live lane leaves it.
"""

import asyncio
import functools
from collections.abc import AsyncIterator, Callable

import pytest
from apps import settled
from fake_control import DEFAULTS, serve_shared
from narrow import present
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import loader
from hqptuner.core.manager import ConnectionManager

#: The main filter slot the live write moves the engine to mid-poll. Differs from
#: the fake's default ``filterNx``, the slot the poll reads in ``State``, so a
#: picture overwritten by that earlier read shows it.
LIVE_WRITTEN_FILTER_NX = "2"


class _LandsOnStatus(list[tuple[str, dict[str, str]]]):
    """The fake daemon's command log, which lands one live write the first time
    the daemon receives ``Status`` after being armed, before that ``Status`` is
    answered."""

    def __init__(self) -> None:
        super().__init__()
        self.land: Callable[[], None] | None = None

    def append(self, entry: tuple[str, dict[str, str]]) -> None:
        super().append(entry)
        if entry[0] == "Status" and self.land is not None:
            land, self.land = self.land, None
            land()


#: A manager connected to the fake and idle on its clock, the fake's live State,
#: and the log that lands the write.
Polled = tuple[ConnectionManager, dict[str, str], _LandsOnStatus]


@pytest.fixture
async def polled(clock: VirtualClock) -> AsyncIterator[Polled]:
    state = {**DEFAULTS}
    log = _LandsOnStatus()
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


def _live_write(manager: ConnectionManager, state: dict[str, str]) -> None:
    """A live filter write as it lands: the engine moves, and the manager's
    picture holds the State the write read back."""
    state["filterNx"] = LIVE_WRITTEN_FILTER_NX
    manager.readings.state = {**present(manager.readings.state), "filterNx": LIVE_WRITTEN_FILTER_NX}


async def test_a_live_write_landing_mid_poll_survives_the_poll_that_read_state_before_it(polled: Polled) -> None:
    manager, state, log = polled
    log.land = functools.partial(_live_write, manager, state)
    await loader.poll(manager)
    assert present(manager.readings.state).get("filterNx") == LIVE_WRITTEN_FILTER_NX
