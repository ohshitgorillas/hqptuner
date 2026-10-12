"""LIVE's own record of what it set: the dormant chain's settings, and every write the engine confirmed."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.lanes.live import dropped
from hqptuner.lanes.live.chain import active_chain
from hqptuner.lanes.settle import Mark, restart_landed

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager
    from hqptuner.lanes.writer import LiveWriteResult


@dataclass(frozen=True)
class OwnRestart:
    """HQPTuner's own restart or reload request the daemon accepted.

    ``mark`` is the control connection that stood at the request (``settle.mark_connect``),
    None for none, and ``at`` the manager's monotonic clock when the daemon accepted it.
    """

    mark: Mark | None
    at: float

    def landed(self, connects: int, drops_at_connect: int) -> bool:
        """Whether the connect counted at ``connects``, with ``drops_at_connect`` drops seen, is the one after it.

        With no connection standing at the request there is no drop to wait for, so the
        first connect after it is. Otherwise it is the first made after the daemon went
        away (``settle.restart_landed``); one that reached the daemon before its restart is not.
        """
        return self.mark is None or restart_landed(self.mark, connects, drops_at_connect)

    def taken_in_place(self, connects: int, now: float, window: float) -> bool:
        """Whether the engine took the request without a restart: its connection still stands past ``window``.

        ``connects`` is the manager's count with a connection standing, ``now`` its monotonic
        clock, and ``window`` its restart deadline: a restart would have taken that connection
        down by then.
        """
        return self.mark is not None and connects == self.mark.connects and now - self.at >= window


class LiveMemory:
    """What LIVE has set that the engine itself cannot hold on to.

    The engine keeps ONE filter/shaper pair, so the moment the loaded chain
    changes there is nothing left on the engine to say what LIVE set for the
    other one. This is that record, and it is what `overrides.live_overrides`
    reports for whichever chain is dormant.

    `chain` is per chain, config-form field -> enum ID — IDs rather than list
    indices because an index is only meaningful while its chain is loaded, which
    is exactly the condition this outlives.

    `written` is every live setting a write changed and the engine confirmed by
    readback, keyed by config-form field, until a new connection finds it lost or
    a restart or reload HQPTuner itself asked for takes it: what a restart can drop
    (`dropped`). It outlives a connection that lost nothing.

    `own_restart` is HQPTuner's own restart or reload request the daemon accepted,
    until the connection after it lands or the engine is found to have taken it in place.
    """

    def __init__(self) -> None:
        """Start out remembering nothing — no setting held for any chain, none written, no restart asked for."""
        self.chain: dict[str, dict[str, str]] = {}
        self.written: dict[str, dropped.WrittenSetting] = {}
        self.own_restart: OwnRestart | None = None

    def confirm(
        self, edits: dict[str, dict[str, str]], report: list[LiveWriteResult], view: dropped.EngineView
    ) -> None:
        """Record what a live batch changed on the engine (``dropped.recorded``)."""
        self.written = dropped.recorded(self.written, edits, report, view)

    def restart_sent(self, mark: Mark | None, at: float) -> None:
        """Note HQPTuner's own restart or reload request, accepted ``at``, with ``mark`` taken before it."""
        self.own_restart = OwnRestart(mark, at)

    def follows_own_restart(self, connects: int, drops_at_connect: int) -> bool:
        """Whether the connect counted at ``connects``, with ``drops_at_connect`` drops seen, follows the request."""
        return self.own_restart is not None and self.own_restart.landed(connects, drops_at_connect)

    def own_reload_in_place(self, connects: int, now: float, window: float) -> bool:
        """Whether the engine took the request in place, as the connection at ``connects`` reads it at ``now``."""
        return self.own_restart is not None and self.own_restart.taken_in_place(connects, now, window)

    def reconnected(self, kept: dict[str, dropped.WrittenSetting]) -> None:
        """Start a new connection: nothing held for any chain, and only ``kept`` of what was written."""
        self.chain.clear()
        self.written = kept

    def restarted(self) -> None:
        """Start the connection after HQPTuner's own restart: what it wrote was lost at its own request.

        Nothing held for any chain, nothing written, and the request consumed.
        """
        self.reconnected({})
        self.own_restart = None

    def reloaded(self, kept: dict[str, dropped.WrittenSetting]) -> None:
        """Settle the engine's in-place take of the request: only ``kept`` of what was written, the request consumed."""
        self.written = kept
        self.own_restart = None

    def forget_chains(self) -> None:
        """Drop what LIVE held for each chain — a LIVE setting lasts only until the daemon restarts.

        For a restart HQPTuner itself caused (``settle.resync_engine_state``). Holding on would
        report, and re-assert, a setting nothing is playing any more. ``written`` is not touched:
        the connection after that restart lets it go (``restarted``).
        """
        self.chain.clear()


def engine_view(mgr: LaneManager) -> dropped.EngineView:
    """Return the engine as the readings report it: State, enumerations, and the chain it has loaded."""
    return dropped.EngineView(mgr.readings.state or {}, mgr.readings.enums or {}, active_chain(mgr))
