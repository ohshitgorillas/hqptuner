"""The control connection coming down, by a fault in the connect loop or by HQPTuner's own hand.

A fault that escapes the connect-and-heartbeat loop while a connection stands ends that connection by HQPTuner's own
hand, which is no departure: the phase reads Down at the generation it stood at, and the Engine readings taken on that
connection are gone. HQPTuner taking the connection down itself leaves the manager holding no Engine readings
either.

Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake and the 8088 fake, the 8088
client riding a transport that raises one fault the loop does not handle on the first request after it is armed, and
reads the phase, the generation or the readings. A reading lost to the fault is read beside a manager on the same
clock whose poll met none.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import fake_http
import httpx
import pytest
from apps import advanced, settled
from conftest import DaemonFactory
from fixtures_daemons import FaultingTransport, ManagerRig
from narrow import FixtureError, present
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.readings import Source, Stamp

#: The manager's poll interval: the fault fires on the first poll after it is armed.
POLL = 2.0
#: The window, long enough that a Down entered on a poll is still Down, not Alarm, when the case reads it.
WINDOW = 10 * POLL

#: The 8088 fake's knobs for a lane answering its form, so the connection stands Ready, and for one answering 503, so
#: it stands Reachable.
LANE_KNOBS: dict[Phase, dict[str, object]] = {Phase.READY: {}, Phase.REACHABLE: {"_down": True}}

#: The generation a fresh manager stands at, with no departure proven.
NO_DEPARTURE = 0

#: Why HQPTuner takes the control connection down in the cases that do.
TAKEN_DOWN_FOR = "a restart was requested"

#: The stamp an Engine reading taken on the fresh manager's connection carries.
READ_ON_THE_CONNECTION = Stamp(source=Source.ENGINE, generation=NO_DEPARTURE)


class _UnhandledFaultError(Exception):
    """A fault no handler inside the connect loop names, so it ends the loop and reaches ``run``."""


def _unhandled_fault(request: httpx.Request) -> Exception:
    return _UnhandledFaultError(request.url.path)


@dataclass
class Standing:
    """A running manager standing on one control connection, and the 8088 wire that can hand it the fault."""

    manager: ConnectionManager
    wire: FaultingTransport


Stand = Callable[[Phase], Awaitable[Standing]]


@pytest.fixture
def stand(daemon: DaemonFactory, clock: VirtualClock, manager_rig: ManagerRig) -> Stand:
    """Spawn ``run`` on a manager over both fakes, handed over once it stands in the given phase with a control client
    and an Engine reading; a manager that does not is a broken fixture and raises."""

    async def begin(phase: Phase) -> Standing:
        port, _commands, _engine = await daemon()
        wire = FaultingTransport(once=True)
        lane = manager_rig.serve(fake_http.state(**LANE_KNOBS[phase]))
        manager = manager_rig.start(port, lane, wire=wire, poll_interval=POLL, alarm_threshold=WINDOW)
        await settled(clock)
        if manager.phase.standing.phase is not phase:
            raise FixtureError(reason=f"the manager stands {manager.phase.standing.phase}, not {phase}")
        present(manager.control)
        present(manager.readings.engine_snapshot())
        return Standing(manager, wire)

    return begin


async def _faulted(stand: Stand, clock: VirtualClock, phase: Phase) -> Standing:
    """A manager standing in ``phase`` whose next poll met a fault the connect loop does not handle."""
    standing = await stand(phase)
    standing.wire.fault = _unhandled_fault
    await advanced(clock, POLL)
    return standing


def _engine_reading(manager: ConnectionManager) -> Stamp | None:
    """The stamp of the Engine reading the manager holds, or None where it holds none."""
    snapshot = manager.readings.engine_snapshot()
    return None if snapshot is None else snapshot.stamp


# --- a fault that ends the connect loop -----------------------------------------------------------------------------


@pytest.mark.parametrize("before", [Phase.READY, Phase.REACHABLE], ids=["from_ready", "from_reachable"])
async def test_a_fault_that_ends_the_connect_loop_puts_the_phase_down(
    stand: Stand, clock: VirtualClock, before: Phase
) -> None:
    standing = await _faulted(stand, clock, before)
    assert standing.manager.phase.standing.phase is Phase.DOWN


@pytest.mark.parametrize("before", [Phase.READY, Phase.REACHABLE], ids=["from_ready", "from_reachable"])
async def test_a_fault_that_ends_the_connect_loop_is_no_departure_and_leaves_the_generation_unchanged(
    stand: Stand, clock: VirtualClock, before: Phase
) -> None:
    standing = await _faulted(stand, clock, before)
    assert standing.manager.phase.standing.generation == NO_DEPARTURE


async def test_a_fault_that_ends_the_connect_loop_leaves_no_engine_reading_from_the_connection_it_ended(
    stand: Stand, clock: VirtualClock
) -> None:
    calm = await stand(Phase.READY)
    faulted = await _faulted(stand, clock, Phase.READY)
    assert (_engine_reading(calm.manager), _engine_reading(faulted.manager)) == (READ_ON_THE_CONNECTION, None)


# --- HQPTuner taking the control connection down --------------------------------------------------------------------


async def test_taking_the_control_connection_down_leaves_no_engine_reading_from_the_connection_it_ended(
    stand: Stand,
) -> None:
    standing = await stand(Phase.READY)
    before = _engine_reading(standing.manager)
    await standing.manager.take_control_down(TAKEN_DOWN_FOR)
    assert (before, _engine_reading(standing.manager)) == (READ_ON_THE_CONNECTION, None)


async def test_taking_the_control_connection_down_leaves_the_phase_down_and_no_control_client(stand: Stand) -> None:
    standing = await stand(Phase.READY)
    manager = standing.manager
    before = (manager.phase.standing.phase, manager.control is not None)
    await manager.take_control_down(TAKEN_DOWN_FOR)
    after = (manager.phase.standing.phase, manager.control is not None)
    assert (before, after) == ((Phase.READY, True), (Phase.DOWN, False))


async def test_taking_the_control_connection_down_is_followed_at_once_by_a_redial(
    stand: Stand, clock: VirtualClock
) -> None:
    standing = await stand(Phase.READY)
    manager = standing.manager
    await manager.take_control_down(TAKEN_DOWN_FOR)
    await settled(clock)
    assert (manager.control is not None, manager.phase.standing.phase) == (True, Phase.READY)
