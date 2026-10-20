"""The standing connection's since-time, and a refused dial while one stands.

The phase is where health's connection's age comes from, so it carries the
clock reading at which the standing connection became Reachable, and a
connection that ends leaves none standing. A dial the daemon refuses or leaves
unanswered while the phase says a connection stands proves a departure like any
other. Each case starts from a standing at a stated phase and generation, feeds
wire facts at the readings its rows give, and reads the standing that comes back.
"""

from collections.abc import Iterable

import pytest

from hqptuner.core.lifecycle import Fact, Phase, Standing, transition

#: Two clock readings a connection may be made at: early in a manager's life,
#: and after the idle close has run once.
CONNECTED_READINGS = [3.0, 157.5]

#: How long after the connection was made each later fact in a case arrives.
LATER = 2.5

#: Two generations a standing may be at when the case starts: a fresh manager,
#: and one that has already seen departures.
GENERATIONS = [0, 4]

#: Wire facts that leave the control connection standing, each fed after the
#: handshake: the configuration lane answering, then stopping, then a restart
#: request accepted and its readback confirmed on the standing connection.
STANDING_FACTS = [
    pytest.param([Fact.FORM_ANSWERED], id="reachable-to-ready"),
    pytest.param([Fact.FORM_ANSWERED, Fact.FORM_STOPPED], id="ready-back-to-reachable"),
    pytest.param([Fact.FORM_ANSWERED, Fact.REQUEST_ACCEPTED, Fact.READBACK_CONFIRMED], id="settled-in-place"),
]

#: Every wire fact that ends a standing connection: the daemon dropping it,
#: HQPTuner taking it down for a restart, and a dial refused while it stood.
ENDINGS = [Fact.SOCKET_LOST, Fact.SOCKET_TAKEN, Fact.DIAL_REFUSED]


def _after(standing: Standing, rows: Iterable[tuple[float, Fact]]) -> Standing:
    """The standing once every row's fact has been fed at its clock reading, in order."""
    for at, fact in rows:
        standing = transition(standing, fact, at)
    return standing


def _connected(at: float, *, generation: int = 1) -> Standing:
    """A standing whose control socket answered ``GetInfo`` at ``at`` from Down."""
    return transition(Standing(phase=Phase.DOWN, generation=generation), Fact.GETINFO_ANSWERED, at)


@pytest.mark.parametrize("phase", [Phase.DOWN, Phase.ALARM])
@pytest.mark.parametrize("at", CONNECTED_READINGS)
def test_a_new_connection_stands_since_the_reading_its_getinfo_answered_at(phase: Phase, at: float) -> None:
    after = transition(Standing(phase=phase, generation=1), Fact.GETINFO_ANSWERED, at)
    assert after.connected_since == at


@pytest.mark.parametrize("facts", STANDING_FACTS)
@pytest.mark.parametrize("at", CONNECTED_READINGS)
def test_the_since_time_holds_while_the_connection_stands(facts: list[Fact], at: float) -> None:
    rows = [(at + LATER * (step + 1), fact) for step, fact in enumerate(facts)]
    assert _after(_connected(at), rows).connected_since == at


@pytest.mark.parametrize("ending", ENDINGS)
@pytest.mark.parametrize("at", CONNECTED_READINGS)
def test_a_connection_ending_leaves_no_since_time_standing(ending: Fact, at: float) -> None:
    ready = _after(_connected(at), [(at + LATER, Fact.FORM_ANSWERED)])
    ended = transition(ready, ending, at + 2 * LATER)
    assert [ready.connected_since, ended.connected_since] == [at, None]


@pytest.mark.parametrize("phase", [Phase.REACHABLE, Phase.READY])
def test_a_refused_dial_while_a_connection_stands_takes_the_daemon_down(phase: Phase) -> None:
    after = transition(Standing(phase=phase, generation=1), Fact.DIAL_REFUSED, CONNECTED_READINGS[0])
    assert after.phase is Phase.DOWN


@pytest.mark.parametrize(("phase", "generation"), [(Phase.REACHABLE, 0), (Phase.READY, 4)])
def test_a_refused_dial_while_a_connection_stands_advances_the_generation_by_one(phase: Phase, generation: int) -> None:
    after = transition(Standing(phase=phase, generation=generation), Fact.DIAL_REFUSED, CONNECTED_READINGS[0])
    assert after.generation == generation + 1


@pytest.mark.parametrize("phase", [Phase.REACHABLE, Phase.READY])
@pytest.mark.parametrize("generation", GENERATIONS)
def test_further_refused_dials_count_a_departure_proven_by_a_refused_dial_once(phase: Phase, generation: int) -> None:
    at = CONNECTED_READINGS[0]
    rows = [(at, Fact.DIAL_REFUSED), (at + LATER, Fact.DIAL_REFUSED), (at + 2 * LATER, Fact.DIAL_REFUSED)]
    assert _after(Standing(phase=phase, generation=generation), rows).generation == generation + 1
