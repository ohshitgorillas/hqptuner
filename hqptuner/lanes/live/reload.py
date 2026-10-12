"""What a heartbeat makes of HQPTuner's own reload request, which the engine may take without a restart.

A function of its arguments: the loader gathers them and applies what this returns.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

from hqptuner.lanes.live import dropped

if TYPE_CHECKING:
    from hqptuner.lanes.live.memory import LiveMemory


class Reloaded(NamedTuple):
    """A heartbeat's verdict on HQPTuner's own reload request.

    ``in_place`` is whether the engine took the request without dropping the connection, and
    ``kept`` what stays recorded.
    """

    in_place: bool
    kept: dict[str, dropped.WrittenSetting]


def on_poll(live: LiveMemory, view: dropped.EngineView, connects: int, now: float, window: float) -> Reloaded:
    """Hold ``live``'s own request and record against the engine a heartbeat reads, ``view``.

    ``connects`` is the count with this connection standing, ``now`` the monotonic clock at the
    heartbeat, and ``window`` the restart deadline (``OwnRestart.taken_in_place``). Taken in
    place, what the engine no longer holds was put back by that reload, at HQPTuner's own
    request: it leaves the record, and nothing reports it. What it still holds stays recorded.
    Not taken in place, the record stands as it is.
    """
    if not live.own_reload_in_place(connects, now, window):
        return Reloaded(in_place=False, kept=dict(live.written))
    return Reloaded(in_place=True, kept=dropped.reconcile(live.written, view).kept)
