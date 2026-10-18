"""The connection's standing and the facts that move it."""

from __future__ import annotations

from dataclasses import dataclass
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


def transition(standing: Standing, fact: Fact, now: float) -> Standing:
    """Return the standing after ``fact`` at ``now``."""
    del fact, now
    return standing


def outcome(standing: Standing) -> Outcome:
    """Return how the restart ended."""
    del standing
    return Outcome.NONE
