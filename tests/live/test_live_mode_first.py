"""A staged output mode rides alone, then the rest of the batch routes against the lists it produced.

`SetMode` swaps the filter, shaper and rate enumerations, so an index resolved before it
runs is stale after it. When the whole batch can go live, the
mode is written on its own re-enumerating path first and the remainder splits against
the post-switch lists. A mode the engine already runs is not sent again: `SetMode` clears
the rate pin even when it changes nothing. A mode the running list cannot name, or one
staged beside a restore-lane field, keeps the batch on the restore lane, where the
restart boots the mode from the config file. A mode the daemon does not take stays a
failed live setter rather than becoming a restart.

Everything runs against the stateful fake daemon over a real socket. Enum ID 57 is PCM
filter index 3 and SDM filter index 2, so a field resolved against the departed chain's
list lands on the wrong filter.
"""

from conftest import LiveManager

from hqptuner.lanes.live.lane import mode_then_split
from hqptuner.lanes.live.routing import split_live

#: Enum ID in both filter lists of the fake: PCM index 3, SDM index 2.
SHARED_FILTER_ID = "57"
#: The SDM and PCM list indices of ``SHARED_FILTER_ID``.
SDM_INDEX_OF_SHARED, PCM_INDEX_OF_SHARED = "2", "3"
#: The fake's State mode indices.
PCM_MODE, SDM_MODE = "1", "2"
#: A pinned rate index on the fake's SDM rate list.
PINNED_RATE = "2"
#: A restore-lane form field: no live setter reaches it.
BUFFER_FIELD = {"alsa_period": "50"}


async def test_the_rest_of_a_mode_batch_resolves_against_the_lists_the_switch_produced(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(mode=PCM_MODE)
    plan = await mode_then_split(manager, {"mode": "sdm", "oversampling": SHARED_FILTER_ID}, {})
    assert plan.live_edits["filter"]["value"] == SDM_INDEX_OF_SHARED


async def test_a_mode_batch_that_routes_whole_sends_nothing_to_the_restore_lane(live_manager: LiveManager) -> None:
    whole = {"mode": "sdm", "oversampling": SHARED_FILTER_ID}
    with_buffer = {**whole, **BUFFER_FIELD}
    manager, _log, _state = await live_manager(mode=PCM_MODE)
    buffered, _log, _state = await live_manager(mode=PCM_MODE)
    plan = await mode_then_split(manager, dict(whole), {})
    buffered_plan = await mode_then_split(buffered, dict(with_buffer), {})
    assert (plan.restore_fields, buffered_plan.restore_fields) == ({}, with_buffer)


async def test_a_staged_mode_alone_leaves_the_next_batch_resolving_against_its_lists(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(mode=PCM_MODE)
    await mode_then_split(manager, {"mode": "sdm"}, {})
    edits, _restore = split_live(manager, {"oversampling": SHARED_FILTER_ID}, {})
    assert edits["filter"]["value"] == SDM_INDEX_OF_SHARED


async def test_a_mode_the_engine_already_runs_is_not_sent_again(live_manager: LiveManager) -> None:
    manager, _log, state = await live_manager(mode=SDM_MODE, rate=PINNED_RATE)
    await mode_then_split(manager, {"mode": "sdm", "oversampling": SHARED_FILTER_ID}, {})
    assert state["rate"] == PINNED_RATE


async def test_a_mode_the_device_cannot_run_sends_the_whole_batch_to_the_restore_lane(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(mode=PCM_MODE, _no_sdm="1")
    batch = {"mode": "sdm", "filter": "40"}
    plan = await mode_then_split(manager, dict(batch), {})
    assert plan.restore_fields == batch


async def test_a_mode_beside_a_restore_lane_field_is_not_written_live(live_manager: LiveManager) -> None:
    manager, _log, state = await live_manager(mode=PCM_MODE)
    await mode_then_split(manager, {"mode": "sdm", **BUFFER_FIELD}, {})
    assert state["mode"] == PCM_MODE


async def test_a_remainder_that_falls_to_the_restore_lane_takes_the_mode_with_it(live_manager: LiveManager) -> None:
    # `filter` is a PCM field, so once the mode has switched the engine to SDM it no
    # longer routes live and the batch's remainder goes to the restore lane.
    manager, _log, _state = await live_manager(mode=PCM_MODE)
    plan = await mode_then_split(manager, {"mode": "sdm", "filter": "40"}, {})
    assert plan.restore_fields.get("mode") == "sdm"


async def test_a_mode_the_engine_does_not_take_is_reported_as_a_failed_live_setter(
    live_manager: LiveManager,
) -> None:
    manager, _log, _state = await live_manager(mode=PCM_MODE, _deaf="SetMode")
    plan = await mode_then_split(manager, {"mode": "sdm"}, {})
    assert [(entry.setting, entry.ok) for entry in plan.report] == [("mode", False)]


async def test_a_batch_without_a_mode_routes_against_the_running_lists(live_manager: LiveManager) -> None:
    manager, _log, _state = await live_manager(mode=PCM_MODE)
    plan = await mode_then_split(manager, {"filter": SHARED_FILTER_ID}, {})
    assert plan.live_edits["filter"]["value"] == PCM_INDEX_OF_SHARED
