"""The daemon's standing moves only on the wire fact that proves the move.

``docs/spec/lifecycle.md`` "The one phase" and "Transitions": the standing is one
phase, the generation counts proven departures and nothing else, and a
transition is a pure function of the standing and one wire fact. Each case
starts from a standing at a stated phase and generation, feeds facts in the
order the wire would deliver them, and reads the standing that comes back.
"""

from collections.abc import Iterable

import pytest

from hqptuner.core.lifecycle import Fact, Phase, Standing, transition

#: The manager's clock reading every fact here is fed at. No case here is about
#: the window, so one reading serves them all.
NOW = 100.0

#: Two generations a standing may be at when the case starts: a fresh manager,
#: and one that has already seen departures.
GENERATIONS = [0, 4]


def _after(standing: Standing, facts: Iterable[Fact]) -> Standing:
    """The standing once every fact has been fed to it, in order."""
    for fact in facts:
        standing = transition(standing, fact, NOW)
    return standing


@pytest.mark.parametrize("phase", [Phase.DOWN, Phase.ALARM])
def test_getinfo_answered_on_a_new_socket_makes_a_disconnected_daemon_reachable(phase: Phase) -> None:
    after = transition(Standing(phase=phase, generation=1), Fact.GETINFO_ANSWERED, NOW)
    assert after.phase is Phase.REACHABLE


@pytest.mark.parametrize("generation", GENERATIONS)
def test_the_configuration_lane_answering_makes_a_reachable_daemon_ready(generation: int) -> None:
    after = transition(Standing(phase=Phase.REACHABLE, generation=generation), Fact.FORM_ANSWERED, NOW)
    assert after.phase is Phase.READY


@pytest.mark.parametrize("generation", GENERATIONS)
def test_the_configuration_lane_stopping_takes_a_ready_daemon_back_to_reachable(generation: int) -> None:
    after = transition(Standing(phase=Phase.READY, generation=generation), Fact.FORM_STOPPED, NOW)
    assert after.phase is Phase.REACHABLE


@pytest.mark.parametrize("phase", [Phase.REACHABLE, Phase.READY])
def test_losing_the_control_socket_takes_a_connected_daemon_down(phase: Phase) -> None:
    after = transition(Standing(phase=phase, generation=1), Fact.SOCKET_LOST, NOW)
    assert after.phase is Phase.DOWN


@pytest.mark.parametrize(("phase", "generation"), [(Phase.REACHABLE, 0), (Phase.READY, 4)])
def test_losing_the_control_socket_advances_the_generation_by_one(phase: Phase, generation: int) -> None:
    after = transition(Standing(phase=phase, generation=generation), Fact.SOCKET_LOST, NOW)
    assert after.generation == generation + 1


@pytest.mark.parametrize("phase", [Phase.REACHABLE, Phase.READY])
def test_closing_the_socket_after_an_accepted_restart_takes_a_connected_daemon_down(phase: Phase) -> None:
    after = transition(Standing(phase=phase, generation=1), Fact.SOCKET_TAKEN, NOW)
    assert after.phase is Phase.DOWN


@pytest.mark.parametrize(("phase", "generation"), [(Phase.REACHABLE, 0), (Phase.READY, 4)])
def test_a_taken_down_stands_at_an_earlier_generation_than_a_proven_one(phase: Phase, generation: int) -> None:
    standing = Standing(phase=phase, generation=generation)
    taken = transition(standing, Fact.SOCKET_TAKEN, NOW)
    proven = transition(standing, Fact.SOCKET_LOST, NOW)
    assert taken.generation < proven.generation


@pytest.mark.parametrize("generation", GENERATIONS)
def test_a_refused_dial_after_a_taken_down_proves_the_departure(generation: int) -> None:
    after = _after(Standing(phase=Phase.READY, generation=generation), [Fact.SOCKET_TAKEN, Fact.DIAL_REFUSED])
    assert after.generation == generation + 1


@pytest.mark.parametrize("generation", GENERATIONS)
def test_refused_dials_after_a_proven_departure_count_it_once(generation: int) -> None:
    facts = [Fact.SOCKET_LOST, Fact.DIAL_REFUSED, Fact.DIAL_REFUSED]
    after = _after(Standing(phase=Phase.READY, generation=generation), facts)
    assert after.generation == generation + 1


@pytest.mark.parametrize("generation", GENERATIONS)
def test_a_taken_down_that_reconnects_counts_only_the_later_departure(generation: int) -> None:
    facts = [Fact.SOCKET_TAKEN, Fact.GETINFO_ANSWERED, Fact.SOCKET_LOST, Fact.DIAL_REFUSED]
    after = _after(Standing(phase=Phase.READY, generation=generation), facts)
    assert after.generation == generation + 1


@pytest.mark.parametrize("departure", [Fact.SOCKET_LOST, Fact.SOCKET_TAKEN])
def test_a_form_answer_arriving_after_the_socket_went_down_leaves_the_daemon_down(departure: Fact) -> None:
    after = _after(Standing(phase=Phase.READY, generation=1), [departure, Fact.FORM_ANSWERED])
    assert after.phase is Phase.DOWN


#: Two sessions as the wire delivers them, each beside the departures it
#: proves. The first drops twice and loses its configuration lane once in
#: between; the second takes its own socket down twice, reconnecting before any
#: dial is refused the first time and being refused twice the second.
SESSIONS = [
    pytest.param(
        [
            Fact.GETINFO_ANSWERED,
            Fact.FORM_ANSWERED,
            Fact.FORM_STOPPED,
            Fact.FORM_ANSWERED,
            Fact.SOCKET_LOST,
            Fact.DIAL_REFUSED,
            Fact.GETINFO_ANSWERED,
            Fact.FORM_ANSWERED,
            Fact.SOCKET_LOST,
        ],
        2,
        id="two-drops",
    ),
    pytest.param(
        [
            Fact.GETINFO_ANSWERED,
            Fact.FORM_ANSWERED,
            Fact.SOCKET_TAKEN,
            Fact.GETINFO_ANSWERED,
            Fact.FORM_ANSWERED,
            Fact.SOCKET_TAKEN,
            Fact.DIAL_REFUSED,
            Fact.DIAL_REFUSED,
            Fact.GETINFO_ANSWERED,
        ],
        1,
        id="two-own-restarts",
    ),
]


@pytest.mark.parametrize(("facts", "departures"), SESSIONS)
def test_the_generation_counts_proven_departures_and_nothing_else(facts: list[Fact], departures: int) -> None:
    assert _after(Standing(), facts).generation == departures
