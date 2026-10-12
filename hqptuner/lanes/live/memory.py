"""LIVE's own record of what it set: the dormant chain's settings, and every write the engine confirmed."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.lanes.live import dropped
from hqptuner.lanes.live.chain import active_chain

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager
    from hqptuner.lanes.writer import LiveWriteResult


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
    readback, keyed by config-form field, until a new connection finds it lost:
    what a restart can drop (`dropped`). It outlives a connection that lost nothing.
    """

    def __init__(self) -> None:
        """Start out remembering nothing — no setting held for any chain, none written."""
        self.chain: dict[str, dict[str, str]] = {}
        self.written: dict[str, dropped.WrittenSetting] = {}

    def confirm(
        self, edits: dict[str, dict[str, str]], report: list[LiveWriteResult], view: dropped.EngineView
    ) -> None:
        """Record what a live batch changed on the engine (``dropped.recorded``)."""
        self.written = dropped.recorded(self.written, edits, report, view)

    def reconnected(self, kept: dict[str, dropped.WrittenSetting]) -> None:
        """Start a new connection: nothing held for any chain, and only ``kept`` of what was written."""
        self.chain.clear()
        self.written = kept

    def forget(self) -> None:
        """Drop everything — a LIVE setting lasts only until the daemon restarts.

        For a restart HQPTuner itself caused (``settle.resync_engine_state``). Holding on would
        report, and re-assert, a setting nothing is playing any more.
        """
        self.chain.clear()
        self.written = {}


def engine_view(mgr: LaneManager) -> dropped.EngineView:
    """Return the engine as the readings report it: State, enumerations, and the chain it has loaded."""
    return dropped.EngineView(mgr.readings.state or {}, mgr.readings.enums or {}, active_chain(mgr))
