"""The connection's standing and the facts that move it."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import Enum


class Phase(Enum):
    """Where the connection stands."""

    DOWN = "down"
    REACHABLE = "reachable"
    READY = "ready"
    ALARM = "alarm"


class Fact(Enum):
    """What was observed."""

    GETINFO_ANSWERED = "getinfo_answered"
    FORM_ANSWERED = "form_answered"
    FORM_STOPPED = "form_stopped"
    SOCKET_LOST = "socket_lost"
    SOCKET_TAKEN = "socket_taken"
    DIAL_REFUSED = "dial_refused"
    WINDOW_RAN = "window_ran"


class Outcome(Enum):
    """How a restart ended."""

    NONE = "none"
    LANDED = "landed"
    SETTLED_IN_PLACE = "settled_in_place"
    FOREIGN_DEPARTURE = "foreign_departure"


@dataclass(frozen=True)
class Stamp:
    """When a generation was first seen."""

    generation: int
    at: float


@dataclass(frozen=True)
class Standing:
    """The connection's standing."""

    phase: Phase = Phase.DOWN
    generation: int = 0
    taken: bool = False
    stamp: Stamp | None = None
    down_since: float | None = None


def _connected(standing: Standing, now: float) -> Standing:
    """Stand Reachable on a new socket that answered ``GetInfo``."""
    del now
    return replace(standing, phase=Phase.REACHABLE, taken=False, down_since=None)


def _ready(standing: Standing, now: float) -> Standing:
    """Stand Ready once the configuration lane answered on this connection."""
    del now
    return replace(standing, phase=Phase.READY)


def _unready(standing: Standing, now: float) -> Standing:
    """Fall back to Reachable when the configuration lane stops answering."""
    del now
    return replace(standing, phase=Phase.REACHABLE)


def _lost(standing: Standing, now: float) -> Standing:
    """Go Down proven when the daemon ends the socket, advancing the generation."""
    return replace(
        standing,
        phase=Phase.DOWN,
        generation=standing.generation + 1,
        taken=False,
        down_since=now,
    )


def _taken(standing: Standing, now: float) -> Standing:
    """Go Down taken when HQPTuner closes the socket ahead of its own restart."""
    return replace(standing, phase=Phase.DOWN, taken=True, down_since=now)


def _refused(standing: Standing, now: float) -> Standing:
    """Prove a taken Down on a refused or unanswered dial."""
    del now
    if not standing.taken:
        return standing
    return replace(standing, generation=standing.generation + 1, taken=False)


_Move = Callable[[Standing, float], Standing]

_TABLE: dict[tuple[Phase, Fact], _Move] = {
    (Phase.DOWN, Fact.GETINFO_ANSWERED): _connected,
    (Phase.ALARM, Fact.GETINFO_ANSWERED): _connected,
    (Phase.REACHABLE, Fact.FORM_ANSWERED): _ready,
    (Phase.READY, Fact.FORM_STOPPED): _unready,
    (Phase.REACHABLE, Fact.SOCKET_LOST): _lost,
    (Phase.READY, Fact.SOCKET_LOST): _lost,
    (Phase.REACHABLE, Fact.SOCKET_TAKEN): _taken,
    (Phase.READY, Fact.SOCKET_TAKEN): _taken,
    (Phase.DOWN, Fact.DIAL_REFUSED): _refused,
}


def transition(standing: Standing, fact: Fact, now: float) -> Standing:
    """Return the standing after ``fact`` at ``now``.

    A fact the table does not list for the current phase moves nothing.
    """
    move = _TABLE.get((standing.phase, fact))
    if move is None:
        return standing
    return move(standing, now)


def outcome(standing: Standing) -> Outcome:
    """Return how the restart ended."""
    del standing
    return Outcome.NONE
