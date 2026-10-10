"""A daemon that stops answering, as the connection manager meets it on its own clock.

Every Control API connect, send and read the manager makes waits under the manager's clock. The test silences
HQPlayer through that clock and lets virtual time pass, so the manager's request timeout runs out without a real
second passing. ``reachable`` is the outcome: it holds up to the poll's deadline and is gone once the deadline is met.
"""

import pytest
from apps import advanced
from conftest import LiveManager
from virtual_clock import VirtualClock

#: Seconds short of the first silent poll's deadline the clock is let run, and whether the manager still reports
#: the daemon reachable there.
SHORT_OF_THE_DEADLINE = [(0.0, False), (1.0, True)]


@pytest.mark.parametrize(("short", "reachable"), SHORT_OF_THE_DEADLINE, ids=["at_the_deadline", "a_second_before"])
async def test_a_daemon_that_stops_answering_is_unreachable_once_a_poll_runs_out_its_request_timeout(
    live_manager: LiveManager, clock: VirtualClock, short: float, *, reachable: bool
) -> None:
    manager, _log, _state = await live_manager()
    clock.fall_silent()
    await advanced(clock, manager.cfg.poll_interval + manager.cfg.request_timeout - short)
    assert manager.reachable is reachable
