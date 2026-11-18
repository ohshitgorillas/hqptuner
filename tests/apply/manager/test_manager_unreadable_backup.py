"""A daemon whose configuration lane answers ``/backup`` on connect with bytes that are no settings archive.

Reachable moves to Ready only once the configuration lane's read has
answered on this connection, and an unreadable archive is not that answer. The control connection stands meanwhile.
Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake and an 8088 fake whose backup
archive is an error page, lets poll intervals pass, and reads the phase or the handshakes the daemon received.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import fake_http
import pytest
from apps import advanced, settled
from conftest import DaemonFactory
from fake_control import CommandLog
from fixtures_daemons import ManagerRig, handshakes
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager

#: The manager's poll interval: every span below is counted in these.
POLL = 2.0
#: The window, long enough that no span below reaches it, so Alarm never stands in for Down.
WINDOW = 20 * POLL
#: Polls let pass after the connect before the manager is read: enough for any redial to have happened.
SPAN = 3 * POLL


@dataclass
class Rig:
    """A running manager over an 8088 fake serving an unreadable backup, and the control fake's received commands."""

    manager: ConnectionManager
    commands: CommandLog


Start = Callable[[], Awaitable[Rig]]


@pytest.fixture
def start(daemon: DaemonFactory, clock: VirtualClock, manager_rig: ManagerRig) -> Start:
    """Spawn ``run`` on a manager holding an 8088 client on a fake whose backup archive is an error page.

    Handed over once the manager idles on the clock after its first connect.
    """

    async def begin() -> Rig:
        port, commands, _engine = await daemon()
        lane = manager_rig.serve(fake_http.state(_corrupt_backup=True))
        http_port = int(lane["_port"])
        manager = manager_rig.start(port, lane, hqp_http_port=http_port, poll_interval=POLL, alarm_threshold=WINDOW)
        await settled(clock)
        return Rig(manager, commands)

    return begin


async def test_an_unreadable_backup_on_connect_leaves_the_daemon_standing_reachable(
    start: Start, clock: VirtualClock
) -> None:
    rig = await start()
    await advanced(clock, SPAN)
    assert rig.manager.phase.standing.phase is Phase.REACHABLE


async def test_an_unreadable_backup_on_connect_keeps_the_control_connection_it_arrived_on(
    start: Start, clock: VirtualClock
) -> None:
    rig = await start()
    await advanced(clock, SPAN)
    assert handshakes(rig.commands) == 1
