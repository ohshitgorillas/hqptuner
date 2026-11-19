"""What the live lane reads back after a verified write, and what a failure of those reads costs.

Everything after a readback-verified live write is bookkeeping for the next one: State
and, when the batch moved an enumeration, the lists. A control failure there is not an
error on the write the user watched land, and a refused State read is a complete reply
that says nothing of the engine, so the last good reading stands.

The chain can also change under a configured mode that stands still: in `[source]` the
engine follows the source, and the next live write must resolve against
the lists of the chain the engine has loaded now.

Everything runs against the stateful fake daemon over a real socket. Enum ID 57 is PCM
filter index 3 and SDM filter index 2.
"""

from collections.abc import Awaitable, Callable

from apps import advanced
from conftest import LiveManager
from fake_control import OnNextArrival
from fixtures_clients import HookedBuilt
from virtual_clock import VirtualClock

from hqptuner.lanes.live.lane import apply_now, refresh_after_live
from hqptuner.lanes.live.routing import resolve_live

#: Enum ID in both filter lists of the fake: SDM index 2.
SHARED_FILTER_ID = "57"
SDM_INDEX_OF_SHARED = "2"
#: A PCM `filter` enum ID the fake's PCM list carries.
GAUSS_LONG_ID = "40"
#: The Nx filter index the engine runs before anything is written, off the fake's resting 0.
RUNNING_NX = "2"


async def test_a_refused_state_read_after_a_live_write_keeps_the_last_good_reading(
    live_manager: LiveManager,
) -> None:
    manager, _log, state = await live_manager(filterNx=RUNNING_NX)
    state["_error"] = "State"
    await refresh_after_live(manager, manager.require_control(), {"shaper": {"value": "1"}})
    reading = manager.readings.state
    assert reading is not None
    assert reading["filterNx"] == RUNNING_NX


async def test_a_failed_list_refresh_after_a_verified_write_leaves_it_reported_applied(
    live_manager: LiveManager,
) -> None:
    manager, _log, state = await live_manager()
    state["_close"] = "GetFilters"
    report = await apply_now(manager, {"filter": GAUSS_LONG_ID})
    assert [(entry.setting, entry.ok) for entry in report.live] == [("filter", True)]


async def test_a_failed_state_read_after_a_verified_mode_write_leaves_it_reported_applied(
    hooked_manager: Callable[..., Awaitable[HookedBuilt]],
) -> None:
    manager, state, hooks = await hooked_manager()
    # The lists are read after the mode's own readback has verified it, so every State
    # read from the moment they are asked for is refused.
    hooks["GetModes"] = OnNextArrival(lambda: state.update(_error="State"))
    report = await apply_now(manager, {"mode": "sdm"})
    assert [(entry.setting, entry.ok) for entry in report.live] == [("mode", True)]


async def test_a_source_switching_family_under_source_mode_brings_the_new_chains_lists(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    manager, _log, state = await live_manager(mode="0", _active_mode="PCM")
    state["_active_mode"] = "SDM (DSD)"
    await advanced(clock, manager.cfg.status_interval)
    edits = resolve_live(manager, {"oversampling": SHARED_FILTER_ID})
    assert edits["filter"]["value"] == SDM_INDEX_OF_SHARED
