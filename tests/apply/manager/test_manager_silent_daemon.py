"""A daemon that stops answering, as the connection manager meets it on its own clock.

Every Control API connect, send and read the manager makes waits under the manager's clock. The test silences
HQPlayer through that clock and lets virtual time pass, so the manager's request timeout runs out without a real
second passing. The clock notes the reading at which each reply wait begins, so the instant the first silent request
went out is read off the run, and the phase is read on either side of that request's deadline.
"""

from dataclasses import dataclass

from apps import advanced
from conftest import LiveManager
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Phase

#: Seconds short of the silent request's deadline the clock is let run in the case that reads the phase before it.
A_MOMENT = 0.001
#: Steps per request timeout the clock is let run in while waiting for the first silent request to go out, so the
#: step that sees it go out ends well short of that request's deadline.
STEPS_PER_TIMEOUT = 4
#: Steps let run before a manager that sends nothing more is given up on; reached only when it never polls again.
STEP_LIMIT = 100


class NothingWentOutError(RuntimeError):
    """The manager sent no request once HQPlayer fell silent, so there is no deadline to read the phase around."""


@dataclass(frozen=True)
class Silenced:
    """Where the daemon stood, as phase and generation, before HQPlayer fell silent and at the reading taken."""

    before: tuple[Phase, int]
    after: tuple[Phase, int]


async def _standing_short_of_the_silent_deadline(
    live_manager: LiveManager, clock: VirtualClock, short: float
) -> Silenced:
    """Silence HQPlayer, let the clock run until the manager's first request after that goes out, then on until
    ``short`` seconds before that request's timeout has elapsed; the standing before the silence and there."""
    manager, _log, _state = await live_manager()
    standing = manager.phase.standing
    before = (standing.phase, standing.generation)
    clock.fall_silent()
    sent = len(clock.reply_waits_began())
    step = manager.cfg.request_timeout / STEPS_PER_TIMEOUT
    for _ in range(STEP_LIMIT):
        if len(clock.reply_waits_began()) > sent:
            break
        await advanced(clock, step)
    else:
        raise NothingWentOutError
    deadline = clock.reply_waits_began()[sent] + manager.cfg.request_timeout
    await advanced(clock, deadline - short - clock.monotonic())
    standing = manager.phase.standing
    return Silenced(before, (standing.phase, standing.generation))


async def test_a_silent_daemons_connection_stands_until_its_request_timeout_has_elapsed(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    silenced = await _standing_short_of_the_silent_deadline(live_manager, clock, A_MOMENT)
    assert silenced.after == silenced.before


async def test_a_silent_daemon_is_down_proven_once_its_request_timeout_has_elapsed(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    silenced = await _standing_short_of_the_silent_deadline(live_manager, clock, 0.0)
    assert silenced.after == (Phase.DOWN, silenced.before[1] + 1)
