"""The apply lane's live half: which staged fields go out on a live setter and which take the restore lane.

The split is all-or-nothing per batch: one field that needs the
restore lane sends the whole batch there, because the restart boots the daemon onto its
config file and a value applied live never reaches that file. A field routes live only
when its whole translation succeeds: the chain it belongs to is the one loaded, its enum
ID is in the running list, and a `SetFilter` pair can be completed from State.

The manager's readings put the Engine on one chain with the tables below, which mirror
`tests/support/fake_control.py`. Config-form values are enum IDs, `Set*` arguments are
list indices. Enum ID 57 sits in both filter lists at different indices, so a field
resolved against the wrong chain's list still finds something and goes to the wrong filter.
"""

from typing import NamedTuple

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.routing import mode_form_value, split_live

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "SDM (DSD)", "value": "1"},
]
#: The modes a device that cannot do DSD offers: no SDM row.
MODES_NO_SDM = MODES[:2]
PCM_FILTERS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": "poly-sinc-gauss-long", "value": "40"},
    {"index": "2", "name": "sinc-M", "value": "25"},
    {"index": "3", "name": "poly-sinc-short-mp", "value": "57"},
]
SDM_FILTERS = [
    {"index": "0", "name": "poly-sinc-gauss-long", "value": "38"},
    {"index": "1", "name": "sinc-M", "value": "23"},
    {"index": "2", "name": "poly-sinc-short-lp", "value": "57"},
]
PCM_SHAPERS = [{"index": "0", "name": "none", "value": "0"}, {"index": "1", "name": "NS9", "value": "5"}]
SDM_SHAPERS = [{"index": "0", "name": "ASDM5", "value": "0"}, {"index": "1", "name": "ASDM7EC", "value": "3"}]

#: Enum ID in both filter lists: PCM index 3, SDM index 2.
SHARED_FILTER_ID = "57"
#: A PCM `filter` enum ID and the PCM list index it names.
GAUSS_LONG_ID, GAUSS_LONG_INDEX = "40", "1"
#: PCM `dither` enum ID 5 is `NS9`.
NS9_ID = "5"
#: A restore-lane form field: no live setter reaches it.
BUFFER_FIELD = {"alsa_period": "50"}
#: A live edit the user staged already, in setter-argument form.
STAGED_JUNK = {"junk_filter": {"value": "1"}}


class Engine(NamedTuple):
    """One Engine reading: State's mode index, what Status says, and the enumerations."""

    mode: str
    status: dict[str, str]
    enums: dict[str, list[dict[str, str]]]


PCM = Engine("1", {"active_mode": "PCM"}, {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS})
SDM = Engine("2", {"active_mode": "SDM (DSD)"}, {"modes": MODES, "filters": SDM_FILTERS, "shapers": SDM_SHAPERS})
#: `[source]` with nothing playing: Status names no family and no rate, so no chain is knowably loaded.
SOURCE_IDLE = Engine("0", {"active_mode": "[source]"}, {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS})
PCM_NO_SDM = Engine("1", {"active_mode": "PCM"}, {"modes": MODES_NO_SDM, "filters": PCM_FILTERS})

#: State on a running engine: both filter halves and the shaper reported.
RUNNING_STATE = {"state": "0", "filter1x": "0", "filterNx": "0", "shaper": "0", "rate": "0"}
#: State from an engine that reports neither filter half.
NO_FILTER_STATE = {"state": "0", "shaper": "0", "rate": "0"}
#: The generation the Engine reading is taken in.
GENERATION = 1


def _manager(engine: Engine = PCM, state: dict[str, str] | None = None) -> ConnectionManager:
    """A bare manager whose readings put the Engine on ``engine`` with ``state`` (default ``RUNNING_STATE``)."""
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.take_engine(
        GENERATION,
        state={**(RUNNING_STATE if state is None else state), "mode": engine.mode},
        status={"state": "0", **engine.status},
        enums=engine.enums,
    )
    return mgr


@pytest.mark.parametrize(("enum_id", "index"), [(GAUSS_LONG_ID, GAUSS_LONG_INDEX), ("25", "2")])
def test_a_routed_filter_goes_out_as_the_list_index_its_enum_id_names(enum_id: str, index: str) -> None:
    edits, _restore = split_live(_manager(), {"filter": enum_id}, {})
    assert edits["filter"]["value"] == index


@pytest.mark.parametrize("running_1x", ["2", "3"])
def test_a_one_sided_filter_edit_carries_the_running_other_half(running_1x: str) -> None:
    mgr = _manager(state={**RUNNING_STATE, "filter1x": running_1x})
    edits, _restore = split_live(mgr, {"filter": GAUSS_LONG_ID}, {})
    assert edits["filter"].get("value1x") == running_1x


def test_a_batch_that_routes_whole_leaves_nothing_for_the_restore_lane() -> None:
    whole = {"filter": GAUSS_LONG_ID, "dither": NS9_ID}
    with_buffer = {**whole, **BUFFER_FIELD}
    _edits, whole_restore = split_live(_manager(), dict(whole), {})
    _edits, buffered_restore = split_live(_manager(), dict(with_buffer), {})
    assert (whole_restore, buffered_restore) == ({}, with_buffer)


def test_one_restore_lane_field_sends_the_whole_batch_to_the_restore_lane() -> None:
    batch = {"filter": GAUSS_LONG_ID, **BUFFER_FIELD}
    _edits, restore = split_live(_manager(), dict(batch), {})
    assert restore == batch


def test_one_restore_lane_field_adds_nothing_to_the_staged_live_edits() -> None:
    edits, _restore = split_live(_manager(), {"filter": GAUSS_LONG_ID, **BUFFER_FIELD}, {**STAGED_JUNK})
    assert edits == STAGED_JUNK


def test_a_mode_beside_a_chain_field_sends_the_whole_batch_to_the_restore_lane() -> None:
    batch = {"mode": "sdm", "filter": GAUSS_LONG_ID}
    _edits, restore = split_live(_manager(), dict(batch), {})
    assert restore == batch


UNLOADED = {
    "sdm-field-on-pcm": (PCM, {"oversampling": SHARED_FILTER_ID}),
    "pcm-field-on-sdm": (SDM, {"filter": SHARED_FILTER_ID}),
    "pcm-field-with-no-chain-knowable": (SOURCE_IDLE, {"filter": GAUSS_LONG_ID}),
}


@pytest.mark.parametrize(("engine", "batch"), UNLOADED.values(), ids=UNLOADED.keys())
def test_a_chain_field_whose_chain_is_not_knowably_loaded_goes_to_the_restore_lane(
    engine: Engine, batch: dict[str, str]
) -> None:
    _edits, restore = split_live(_manager(engine), dict(batch), {})
    assert restore == batch


@pytest.mark.parametrize("field", ["filter", "filter1x"])
def test_a_filter_edit_state_cannot_complete_goes_to_the_restore_lane(field: str) -> None:
    batch = {field: GAUSS_LONG_ID}
    _edits, restore = split_live(_manager(state=NO_FILTER_STATE), dict(batch), {})
    assert restore == batch


UNNAMED_MODES = {
    "sdm-on-a-device-without-dsd": (PCM_NO_SDM, "sdm"),
    "a-value-outside-the-form-domain": (PCM, "dsd"),
}


@pytest.mark.parametrize(("engine", "mode"), UNNAMED_MODES.values(), ids=UNNAMED_MODES.keys())
def test_a_mode_the_running_modes_list_cannot_name_goes_to_the_restore_lane(engine: Engine, mode: str) -> None:
    _edits, restore = split_live(_manager(engine), {"mode": mode}, {})
    assert restore == {"mode": mode}


def test_routed_setter_args_join_the_live_edits_already_staged() -> None:
    edits, _restore = split_live(_manager(), {"dither": NS9_ID}, {**STAGED_JUNK})
    assert edits.get("junk_filter") == STAGED_JUNK["junk_filter"]


def test_routing_leaves_the_staged_live_edits_it_was_handed_unchanged() -> None:
    staged = {"shaper": {"value": "0"}}
    split_live(_manager(), {"dither": NS9_ID}, staged)
    assert staged == {"shaper": {"value": "0"}}


@pytest.mark.parametrize(("index", "form_value"), [("0", "auto"), ("1", "pcm"), ("2", "sdm"), ("7", None)])
def test_a_mode_index_names_its_form_value_only_where_the_modes_list_carries_it(
    index: str, form_value: str | None
) -> None:
    assert mode_form_value(MODES, index) == form_value
