"""A heartbeat's verdict on HQPTuner's own reload request, which the engine may take in place.

A reload the engine takes without a restart leaves the control connection standing. Once
the restart deadline has passed on the connection that stood at the request, the engine
took it in place: what it no longer holds leaves the record, and what it still holds stays.

Times are seconds on a monotonic clock the test passes in; the window is the production
alarm threshold.
"""

from typing import NamedTuple

import pytest

from hqptuner.lanes.live import dropped, reload
from hqptuner.lanes.live.memory import LiveMemory
from hqptuner.lanes.settle import Mark

#: The restart deadline: a restart would have taken the connection down by then.
WINDOW = 15.0

#: The monotonic instant the daemon accepted the request.
ASKED_AT = 100.0

#: The connection standing when the request went out.
MARK = Mark(connects=4, drops=1)

#: Two confirmed live writes: adaptive volume on, and the rate pinned at 705600 Hz.
ADAPTIVE_ON = dropped.WrittenSetting("adaptive_volume", "1", None)
RATE_PINNED = dropped.WrittenSetting("rate", "705600", None)
RECORD = {ADAPTIVE_ON.field: ADAPTIVE_ON, RATE_PINNED.field: RATE_PINNED}

#: The engine after the reload: adaptive volume back off, the rate still on list index 3, 705600 Hz.
RELOADED_ENGINE = dropped.EngineView(
    {"adaptive": "0", "rate": "3"},
    {"rates": [{"index": "0", "rate": "0"}, {"index": "3", "rate": "705600"}]},
    None,
)


def _remembering(*, asked: bool, mark: Mark | None) -> LiveMemory:
    """LIVE's memory holding ``RECORD``, and the request accepted at ``ASKED_AT`` with ``mark`` when ``asked``."""
    live = LiveMemory()
    live.reconnected(dict(RECORD))
    if asked:
        live.restart_sent(mark, ASKED_AT)
    return live


class Heartbeat(NamedTuple):
    """Whether a request was made and with which mark, the connection count and seconds since it, and the verdict."""

    asked: bool
    mark: Mark | None
    connects: int
    elapsed: float
    in_place: bool


HEARTBEATS = {
    "window passed on the same connection": Heartbeat(
        asked=True, mark=MARK, connects=MARK.connects, elapsed=WINDOW, in_place=True
    ),
    "window still open": Heartbeat(asked=True, mark=MARK, connects=MARK.connects, elapsed=WINDOW - 1.0, in_place=False),
    "new connection since the request": Heartbeat(
        asked=True, mark=MARK, connects=MARK.connects + 1, elapsed=WINDOW, in_place=False
    ),
    "no connection at the request": Heartbeat(
        asked=True, mark=None, connects=MARK.connects, elapsed=WINDOW, in_place=False
    ),
    "no request": Heartbeat(asked=False, mark=None, connects=MARK.connects, elapsed=WINDOW, in_place=False),
}


@pytest.mark.parametrize("beat", HEARTBEATS.values(), ids=HEARTBEATS.keys())
def test_the_engine_took_the_request_in_place_only_once_the_window_passed_on_the_connection_that_stood_at_it(
    beat: Heartbeat,
) -> None:
    live = _remembering(asked=beat.asked, mark=beat.mark)
    verdict = reload.on_poll(live, RELOADED_ENGINE, beat.connects, ASKED_AT + beat.elapsed, WINDOW)
    assert verdict.in_place == beat.in_place


def test_a_reload_taken_in_place_keeps_only_what_the_engine_still_holds() -> None:
    live = _remembering(asked=True, mark=MARK)
    verdict = reload.on_poll(live, RELOADED_ENGINE, MARK.connects, ASKED_AT + WINDOW, WINDOW)
    assert verdict.kept == {RATE_PINNED.field: RATE_PINNED}
