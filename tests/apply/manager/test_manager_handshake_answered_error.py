"""A dial whose ``GetInfo`` handshake the daemon answers ``result="Error"``.

An Error reply is an answer, complete and correctly paired, so the handshake has answered and a connection stands:
the daemon is Reachable on the socket the answer came on, and the dial is not a refused one.

Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake with no configuration lane,
so Reachable is the only phase a standing connection can take, lets the clock run past the window, and reads the
phase or the handshakes the daemon answered.
"""

from apps import advanced
from conftest import LiveBuilt, LiveManager
from fake_control import CommandLog
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Phase

#: The window a manager built on the default config runs under.
WINDOW = 15.0
#: Clock let run after the first dial: twice the window, long enough for a dial counted as refused to turn Alarm
#: and to be redialed on the retry cadence.
OBSERVED_SPAN = 2 * WINDOW

#: The daemon's own diagnostic on its refusal of the handshake, the element text of its Error reply.
DIAGNOSTIC = "handshake declined by the test daemon"


async def _handshake_refused(live_manager: LiveManager, clock: VirtualClock) -> LiveBuilt:
    """A manager whose every ``GetInfo`` the daemon answers ``result="Error"``, after the observed span."""
    built = await live_manager(_error="GetInfo", _error_text=DIAGNOSTIC)
    await advanced(clock, OBSERVED_SPAN)
    return built


def _handshakes(commands: CommandLog) -> int:
    """How many handshakes the daemon answered: one ``GetInfo`` opens each control connection."""
    return sum(1 for name, _ in commands if name == "GetInfo")


async def test_a_handshake_answered_with_an_error_stands_the_daemon_reachable(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    manager, _commands, _engine = await _handshake_refused(live_manager, clock)
    assert manager.phase.standing.phase is Phase.REACHABLE


async def test_a_handshake_answered_with_an_error_is_no_refused_dial_and_keeps_the_socket_it_came_on(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    _manager, commands, _engine = await _handshake_refused(live_manager, clock)
    assert _handshakes(commands) == 1
