"""Whether the app is whole — the fact the status pill, the page dim and the post-restore wait key on.

A peer of ``core/readings``: that holds what the daemon last told us, this holds what we are
entitled to say about the connection those readings came off.

"Reachable" is the 4321 handshake alone and turns true before the rest of the connect has run, so
it cannot answer the only question the UI and the write lanes actually ask: is what we are holding
the current engine's. Three facts answer it.

``loaded`` is the connect body having run to its end. ``connects`` counts completed connects, ever,
and is the only per-connect fact in the process — ``readings.loaded_at`` is rewritten by every poll,
so it cannot tell a reconnect from a tick. ``restart_gen`` is the generation a restore killed, or
None when no such write is outstanding, and it is what makes readiness mean "newer than the last
restart" rather than "true at some point".

Facts only: nothing here touches a socket or a clock. The manager records the events, the status
route reads ``ready``, and ``lanes.settle.await_ready`` sleeps on ``progress``.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.core.readings import Readings


class Readiness:
    """The connection's generation, and whether a restore is outstanding against it."""

    def __init__(self, readings: Readings, *, has_http_lane: bool) -> None:
        """Bind to the readings whose configuration-lane error decides the 8088 half.

        ``has_http_lane`` is False on an install with no management credentials: there is no 8088
        lane to wait for, ever (architecture §"Authentication"), so that half is vacuous there.
        """
        self._readings = readings
        self._has_http_lane = has_http_lane
        self.loaded = False
        self.connects = 0
        self.restart_gen: int | None = None
        # Pulsed at the end of every connect body and every poll: the two moments the facts
        # below can move. A waiter clears it, re-checks, then waits, so a pulse landing in
        # between is never missed and one that landed earlier never wakes it for nothing.
        self.progress = asyncio.Event()

    def connected(self) -> None:
        """Record a connect that ran to its end."""
        self.loaded = True
        self.connects += 1
        self._settle()

    def dropped(self) -> None:
        """Record the connection going away.

        Leaves an outstanding restore outstanding: the drop is what that restore was waiting for,
        not evidence it has been served.
        """
        self.loaded = False

    def polled(self) -> None:
        """Record a poll that ran to its end, the 8088 form refresh included."""
        self._settle()

    def restarting(self) -> None:
        """Record that the connection live right now is being restarted out from under us."""
        self.restart_gen = self.connects

    def forget_restart(self) -> None:
        """Drop the outstanding-restore mark.

        Held past its own deadline the mark would dim the app indefinitely over a restart nobody can
        prove happened, so the wait drops it whichever way it ends.
        """
        self.restart_gen = None

    @property
    def http_lane_ok(self) -> bool:
        """Whether the 8088 lane is answering — vacuously true where no credentials configured one."""
        return not self._has_http_lane or self._readings.config_error is None

    @property
    def ready(self) -> bool:
        """Report whether the app is whole: a completed connect, newer than any restore in flight.

        Two readings, and the difference between them is the whole point.

        With no restore outstanding this is the connect body having finished, and the 8088 lane is
        not consulted at all. That is deliberate: the configuration lane's error is rewritten by
        every poll and by any live write that refreshes the forms, so consulting it unconditionally
        would take the page down on a blip during a matrix profile switch — a write that restarts
        nothing.

        With a restore outstanding it is the conjunction the user sees as the page dim: a connect
        NEWER than the one that restore killed, plus the configuration lane answering again.
        """
        if not self.loaded:
            return False
        if self.restart_gen is None:
            return True
        return self.connects > self.restart_gen and self.http_lane_ok

    def _settle(self) -> None:
        """Pulse the waiters, and drop the mark once both lanes have answered past it.

        Without the drop the mark stands forever for a restore nobody waited out (the restore
        route), and every later configuration-lane blip reads as a dead connection, which is the
        matrix-switch dim again.
        """
        if self.restart_gen is not None and self.ready:
            self.forget_restart()
        self.progress.set()
