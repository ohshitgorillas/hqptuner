"""HQPTuner closing its own connection because the daemon's address changed.

The owner's ruling on a retarget: closing the connection to the old address is a
taken Down, never a proven one, and leaves the generation where it stood. The
new address then earns Reachable and Ready on its own answers at that same
generation, and only a dial it refuses proves a departure and advances the
generation by one. Each case starts from a standing connected to the old
address at a stated phase and generation, feeds facts in the order the wire
would deliver them, and reads the standing that comes back.
"""

from collections.abc import Iterable

import pytest

from hqptuner.core.lifecycle import Fact, Phase, Standing, transition

#: The manager's clock reading every fact here is fed at. No case here is about
#: the window, so one reading serves them all.
NOW = 100.0

#: Standings connected to the old address a retarget may find: a fresh manager
#: whose configuration lane has not answered, and a Ready one that has already
#: seen departures.
CONNECTED = [(Phase.REACHABLE, 0), (Phase.READY, 4)]


def _after(standing: Standing, facts: Iterable[Fact]) -> Standing:
    """The standing once every fact has been fed to it, in order."""
    for fact in facts:
        standing = transition(standing, fact, NOW)
    return standing


@pytest.mark.parametrize(("phase", "generation"), CONNECTED)
def test_closing_the_old_address_stands_the_daemon_at_a_taken_down(phase: Phase, generation: int) -> None:
    after = transition(Standing(phase=phase, generation=generation), Fact.SOCKET_CLOSED, NOW)
    assert [after.phase, after.generation] == [Phase.DOWN, generation]


@pytest.mark.parametrize(("phase", "generation"), CONNECTED)
def test_the_new_addresss_getinfo_makes_a_retargeted_daemon_reachable(phase: Phase, generation: int) -> None:
    after = _after(Standing(phase=phase, generation=generation), [Fact.SOCKET_CLOSED, Fact.GETINFO_ANSWERED])
    assert after.phase is Phase.REACHABLE


@pytest.mark.parametrize(("phase", "generation"), CONNECTED)
def test_a_form_answer_before_the_new_addresss_getinfo_leaves_a_retargeted_daemon_down(
    phase: Phase, generation: int
) -> None:
    after = _after(Standing(phase=phase, generation=generation), [Fact.SOCKET_CLOSED, Fact.FORM_ANSWERED])
    assert after.phase is Phase.DOWN


@pytest.mark.parametrize(("phase", "generation"), CONNECTED)
def test_the_new_address_answers_at_the_generation_the_retarget_left_unchanged(phase: Phase, generation: int) -> None:
    after = _after(Standing(phase=phase, generation=generation), [Fact.SOCKET_CLOSED, Fact.GETINFO_ANSWERED])
    assert after.generation == generation


@pytest.mark.parametrize(("phase", "generation"), CONNECTED)
def test_a_dial_refused_after_the_retarget_proves_a_departure_at_the_next_generation(
    phase: Phase, generation: int
) -> None:
    after = _after(Standing(phase=phase, generation=generation), [Fact.SOCKET_CLOSED, Fact.DIAL_REFUSED])
    assert after.generation == generation + 1
