"""A live apply reports when the engine stopped playing under it.

The engine goes from playing (`State.state` 2) to stopped (0) or stop requested (3)
when a write takes it down mid-track, and the report says so. Every other pair of
readings is no stop: playing to playing or paused, and any batch that began with the
engine not playing. A command hook on the setter moves the fake daemon's State at the
moment the batch writes it, so the batch's own re-read sees the move.

Everything runs against the stateful fake daemon over a real socket, on the virtual clock.
"""

from collections.abc import Awaitable, Callable

import pytest
from fixtures_clients import HookedBuilt

from hqptuner.lanes.live.lane import apply_now, apply_preset

STOPPED = "0"
PAUSED = "1"
PLAYING = "2"
STOP_REQUESTED = "3"
SDM_MODULATOR_ID = "3"
PCM_FILTER_ID = "40"


@pytest.mark.parametrize(
    ("before", "after", "stopped"),
    [
        (PLAYING, STOPPED, True),
        (PLAYING, STOP_REQUESTED, True),
        (PLAYING, PLAYING, False),
        (PLAYING, PAUSED, False),
        (STOPPED, STOPPED, False),
        (PAUSED, STOPPED, False),
        (STOP_REQUESTED, STOPPED, False),
    ],
)
async def test_a_live_batch_reports_a_stop_only_when_it_took_playback_from_playing_to_stopped(
    hooked_manager: Callable[..., Awaitable[HookedBuilt]], before: str, after: str, *, stopped: bool
) -> None:
    manager, state, hooks = await hooked_manager(state=before)
    hooks["SetFilter"] = lambda: state.update(state=after)
    report = await apply_now(manager, {"filter": PCM_FILTER_ID})
    assert report.playback_stopped == stopped


@pytest.mark.parametrize("batch", ["SetMode", "SetShaping"])
async def test_a_preset_reports_a_stop_that_either_of_its_batches_caused(
    hooked_manager: Callable[..., Awaitable[HookedBuilt]], batch: str
) -> None:
    manager, state, hooks = await hooked_manager(state=PLAYING)
    hooks[batch] = lambda: state.update(state=STOPPED)
    report = await apply_preset(manager, {"mode": "sdm", "modulator": SDM_MODULATOR_ID})
    assert report.playback_stopped is True
