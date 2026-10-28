"""The connection's standing and the facts that move it."""

from __future__ import annotations

import asyncio
import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.clock import Clock


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
    SOCKET_CLOSED = "socket_closed"
    DIAL_REFUSED = "dial_refused"
    WINDOW_RAN = "window_ran"
    REQUEST_ACCEPTED = "request_accepted"
    READBACK_CONFIRMED = "readback_confirmed"


class Outcome(Enum):
    """How a restart ended."""

    NONE = "none"
    LANDED = "landed"
    SETTLED_IN_PLACE = "settled_in_place"
    SETTLED_BY_DEADLINE = "settled_by_deadline"
    FOREIGN_DEPARTURE = "foreign_departure"


@dataclass(frozen=True)
class Stamp:
    """The generation and clock reading at which a restart request was accepted."""

    generation: int
    at: float  # the manager's monotonic clock, seconds: when the request was accepted


@dataclass(frozen=True)
class Standing:
    """The connection's standing.

    ``stamp`` is the restart request still pending, if any. ``ended`` is how the last
    request or departure ended, and reads ``NONE`` while a request is pending.
    ``connected_since`` is the reading of the manager's monotonic clock, in seconds, at
    which the standing connection answered ``GetInfo``, and ``None`` while no connection
    stands.
    """

    phase: Phase = Phase.DOWN
    generation: int = 0
    taken: bool = False
    stamp: Stamp | None = None
    down_since: float | None = None  # the manager's monotonic clock, seconds: when the connection went down
    ended: Outcome = Outcome.NONE
    connected_since: float | None = None


CONNECTED_PHASES = frozenset({Phase.REACHABLE, Phase.READY})


def _connected(standing: Standing, now: float) -> Standing:
    """Stand Reachable since ``now`` on a new socket that answered ``GetInfo``."""
    return replace(standing, phase=Phase.REACHABLE, taken=False, down_since=None, connected_since=now)


def _ready(standing: Standing, now: float) -> Standing:
    """Stand Ready once the configuration lane answered on this connection."""
    del now
    return replace(standing, phase=Phase.READY)


def _unready(standing: Standing, now: float) -> Standing:
    """Fall back to Reachable when the configuration lane stops answering."""
    del now
    return replace(standing, phase=Phase.REACHABLE)


def _lost(standing: Standing, now: float) -> Standing:
    """Go Down proven when the daemon ends the socket or refuses a dial, advancing the generation."""
    return replace(
        standing,
        phase=Phase.DOWN,
        generation=standing.generation + 1,
        taken=False,
        down_since=now,
        connected_since=None,
    )


def _taken(standing: Standing, now: float) -> Standing:
    """Go Down taken when HQPTuner closes the control socket itself, leaving the generation where it stood."""
    return replace(standing, phase=Phase.DOWN, taken=True, down_since=now, connected_since=None)


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
    (Phase.REACHABLE, Fact.SOCKET_CLOSED): _taken,
    (Phase.READY, Fact.SOCKET_CLOSED): _taken,
    (Phase.REACHABLE, Fact.DIAL_REFUSED): _lost,
    (Phase.READY, Fact.DIAL_REFUSED): _lost,
    (Phase.DOWN, Fact.DIAL_REFUSED): _refused,
    (Phase.ALARM, Fact.DIAL_REFUSED): _refused,
}


def _stamp(standing: Standing, now: float) -> Stamp:
    """Return the request stamp a request accepted at ``now`` writes."""
    return Stamp(generation=standing.generation, at=now)


def _requested(standing: Standing, now: float) -> Standing:
    """Write the request stamp; nothing has ended while it is pending."""
    return replace(standing, stamp=_stamp(standing, now), ended=Outcome.NONE)


def _confirmed(standing: Standing) -> Standing:
    """Settle the pending request in place when its readback confirmed with the generation unmoved."""
    stamp = standing.stamp
    if stamp is None or standing.phase not in CONNECTED_PHASES or standing.generation != stamp.generation:
        return standing
    return replace(standing, stamp=None, ended=Outcome.SETTLED_IN_PLACE)


def _alarmed(standing: Standing, now: float, window: float) -> Standing:
    """Raise Alarm once the window has run since Down was entered."""
    since = standing.down_since
    if standing.phase is not Phase.DOWN or since is None or now - since < window:
        return standing
    return replace(standing, phase=Phase.ALARM)


def _deadline_ran(standing: Standing, now: float, window: float) -> Standing:
    """Settle the pending request by deadline once the window has run with the generation unmoved."""
    stamp = standing.stamp
    if stamp is None or standing.generation != stamp.generation or now - stamp.at < window:
        return standing
    return replace(standing, stamp=None, ended=Outcome.SETTLED_BY_DEADLINE)


def _resolved(before: Standing, after: Standing) -> Standing:
    """Read what a phase move ended: a request landed, or a departure no request explains."""
    stamp = after.stamp
    if stamp is None:
        if after.generation > before.generation:
            return replace(after, ended=Outcome.FOREIGN_DEPARTURE)
        return after
    if after.phase is Phase.READY and after.generation > stamp.generation:
        return replace(after, stamp=None, ended=Outcome.LANDED)
    return after


def transition(standing: Standing, fact: Fact, now: float, *, window: float = math.inf) -> Standing:
    """Return the standing after ``fact`` at ``now``, under a ``window`` that never runs when none is given.

    A fact the table does not list for the current phase moves nothing.
    """
    if fact is Fact.REQUEST_ACCEPTED:
        return _requested(standing, now)
    if fact is Fact.READBACK_CONFIRMED:
        return _confirmed(standing)
    if fact is Fact.WINDOW_RAN:
        return _deadline_ran(_alarmed(standing, now, window), now, window)
    move = _TABLE.get((standing.phase, fact))
    if move is None:
        return standing
    return _resolved(standing, move(standing, now))


def outcome(standing: Standing) -> Outcome:
    """Return how the last restart request or departure ended; ``NONE`` while a request is pending."""
    return standing.ended


_Holds = Callable[[Standing], bool]


class Lifecycle:
    """The one home of the standing, the window it runs under and the wake every transition sets.

    ``changed`` is set on every transition and cleared by whoever paces on it. A wait
    subscribes on its own: its condition is tested on each transition as it happens, so
    it returns on the edge that satisfied it even if a later one has already moved on.
    """

    def __init__(self, window: float, now: float) -> None:
        """Stand Down since ``now`` under ``window``, the longest a restart may take before an outage."""
        self._standing = Standing(down_since=now)
        self._window = window
        self._edges: dict[asyncio.Event, _Holds] = {}
        self.changed = asyncio.Event()

    @property
    def standing(self) -> Standing:
        """The standing as it is now."""
        return self._standing

    def report(self, fact: Fact, now: float) -> None:
        """Apply ``fact`` observed at ``now`` and, if it moved anything, wake every subscriber."""
        after = transition(self._standing, fact, now, window=self._window)
        if after == self._standing:
            return
        self._standing = after
        self.changed.set()
        for edge, holds in self._edges.items():
            if holds(after):
                edge.set()

    def request_accepted(self, now: float) -> Stamp:
        """Stamp a restart request the daemon accepted at ``now`` and return the stamp to wait on."""
        mark = _stamp(self._standing, now)
        self.report(Fact.REQUEST_ACCEPTED, now)
        return mark

    def readback_confirmed(self, now: float) -> None:
        """Report that a write's own readback confirmed on the standing connection at ``now``."""
        self.report(Fact.READBACK_CONFIRMED, now)

    def outcome(self) -> Outcome:
        """How the last restart request or departure ended."""
        return outcome(self._standing)

    async def until_ready(self, *, after: Stamp, clock: Clock, deadline: float | None = None) -> bool:
        """Wait on ``clock`` for Ready at a generation later than ``after``'s.

        Answers whether it came before ``deadline``, which defaults to the window; ``False`` is
        the deadline passed, for the caller to report.
        """

        def landed(standing: Standing) -> bool:
            return standing.phase is Phase.READY and standing.generation > after.generation

        return await self._until(landed, clock, deadline)

    async def _until(self, holds: _Holds, clock: Clock, deadline: float | None) -> bool:
        """Wait on ``clock`` for a transition after which ``holds``; answer whether one came in time."""
        if holds(self._standing):
            return True
        edge = asyncio.Event()
        self._edges[edge] = holds
        try:
            return await clock.wait(edge, self._window if deadline is None else deadline)
        finally:
            del self._edges[edge]
