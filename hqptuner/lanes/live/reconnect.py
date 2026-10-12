"""What a new connection makes of LIVE's record of confirmed writes.

A function of its arguments: the loader gathers them and applies what this returns.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

from hqptuner.lanes.live import dropped

if TYPE_CHECKING:
    from hqptuner.lanes.live.memory import LiveMemory


class Reconnected(NamedTuple):
    """A new connection's verdict on the record.

    ``own_restart`` is whether the connection follows HQPTuner's own restart, ``report`` the
    standing dropped-settings report to hold, and ``kept`` what stays recorded.
    """

    own_restart: bool
    report: tuple[dropped.WrittenSetting, ...]
    kept: dict[str, dropped.WrittenSetting]


def on_connect(
    live: LiveMemory,
    view: dropped.EngineView,
    connects: int,
    drops: int,
    report: tuple[dropped.WrittenSetting, ...],
) -> Reconnected:
    """Hold ``live``'s record against a new connection's engine, ``view``.

    ``connects`` is the count of connections before this one and ``drops`` the drops seen;
    ``report`` is the standing dropped-settings report. After a restart the engine is back on
    its config file, and the record is all that knows what it lost. What it lost joins the
    report, which keeps everything it lists until the user clears it (``dropped.merged``).
    What it still holds stays recorded, so a later restart can still report it. After a
    restart HQPTuner asked for, what it lost was lost at HQPTuner's own request: the record
    is let go with nothing listed, and the report stands as it was.
    """
    if live.follows_own_restart(connects + 1, drops):
        return Reconnected(own_restart=True, report=report, kept={})
    reconciled = dropped.reconcile(live.written, view)
    return Reconnected(own_restart=False, report=dropped.merged(report, reconciled.dropped), kept=reconciled.kept)
