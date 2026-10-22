from collections.abc import Mapping

import pytest
from answered_reading import Answered

from hqptuner.engine.view import EngineView, Reading

PCM_MODE = "2"
SDM_MODE = "0"
SOURCE_MODE = "1"
FIRST = "0"
SECOND = "1"
FILTER_NAME = "fixture-filter-b"
SHAPER_NAME = "fixture-shaper-b"
VOLUME = "-23.5"
ENUMERATIONS = {
    "modes": [
        {"index": SDM_MODE, "name": "SDM (DSD)", "value": "1"},
        {"index": SOURCE_MODE, "name": "[source]", "value": "-1"},
        {"index": PCM_MODE, "name": "PCM", "value": "0"},
    ],
    "filters": [
        {"index": FIRST, "name": "fixture-filter-a", "value": "31"},
        {"index": SECOND, "name": FILTER_NAME, "value": "47"},
    ],
    "shapers": [
        {"index": FIRST, "name": "fixture-shaper-a", "value": "17"},
        {"index": SECOND, "name": SHAPER_NAME, "value": "29"},
    ],
    "rates": [
        {"index": FIRST, "rate": "48000"},
        {"index": SECOND, "rate": "192000"},
    ],
}
STATE = {
    "mode": PCM_MODE,
    "filter1x": FIRST,
    "filterNx": SECOND,
    "shaper": SECOND,
    "rate": SECOND,
    "volume": VOLUME,
    "adaptive": SECOND,
}


def view_of(state: Mapping[str, str], status: Mapping[str, str] | None = None) -> EngineView:
    return EngineView.of(Answered(state, status, ENUMERATIONS, None))


# Break: normalize the raw State index into the form enum ID or mode token.
@pytest.mark.parametrize(
    ("mode", "field", "expected"),
    [
        (PCM_MODE, "filter", Reading(SECOND, FILTER_NAME)),
        (PCM_MODE, "filter1x", Reading(FIRST, "fixture-filter-a")),
        (PCM_MODE, "dither", Reading(SECOND, SHAPER_NAME)),
        (SDM_MODE, "oversampling", Reading(SECOND, FILTER_NAME)),
        (SDM_MODE, "oversampling1x", Reading(FIRST, "fixture-filter-a")),
        (SDM_MODE, "modulator", Reading(SECOND, SHAPER_NAME)),
        (PCM_MODE, "mode", Reading(PCM_MODE, "PCM")),
        (SDM_MODE, "mode", Reading(SDM_MODE, "SDM (DSD)")),
    ],
)
def test_raw_enumeration_reading_keeps_state_index_and_engine_name(mode: str, field: str, expected: Reading) -> None:
    assert view_of({**STATE, "mode": mode}).raw_read(field) == expected


# Break: return the rate in Hz instead of its State index.
@pytest.mark.parametrize("index", [FIRST, SECOND])
def test_raw_rate_value_is_the_state_index(index: str) -> None:
    reading = view_of({**STATE, "rate": index}).raw_read("rate")
    assert reading is not None
    assert reading.value == index


# Break: treat a scalar State value as an enumeration index.
@pytest.mark.parametrize(
    ("attribute", "field", "value"),
    [("volume", "volume", VOLUME), ("volume", "volume", "-41.25"), ("adaptive", "adaptive_volume", SECOND)],
)
def test_raw_scalar_reading_keeps_the_state_value_as_its_name(attribute: str, field: str, value: str) -> None:
    assert view_of({**STATE, attribute: value}).raw_read(field) == Reading(value, value)


# Break: let both chain twins read the same State attribute regardless of loaded chain.
@pytest.mark.parametrize(
    ("mode", "on_chain", "off_chain"),
    [(PCM_MODE, "filter", "oversampling"), (SDM_MODE, "modulator", "dither")],
)
def test_raw_chain_twins_have_different_availability(mode: str, on_chain: str, off_chain: str) -> None:
    view = view_of({**STATE, "mode": mode})
    assert view.raw_read(on_chain) != view.raw_read(off_chain)


# Break: require a configured chain and ignore the loaded chain in source mode.
@pytest.mark.parametrize(
    ("active_mode", "field", "expected"),
    [("PCM", "filter", Reading(SECOND, FILTER_NAME)), ("SDM (DSD)", "modulator", Reading(SECOND, SHAPER_NAME))],
)
def test_raw_source_mode_reads_the_loaded_chain(active_mode: str, field: str, expected: Reading) -> None:
    view = view_of({**STATE, "mode": SOURCE_MODE}, {"active_mode": active_mode})
    assert view.raw_read(field) == expected


# Break: synthesize a reading when its State or enumeration source is unread.
@pytest.mark.parametrize(
    "unread",
    [
        pytest.param(Answered(None, None, ENUMERATIONS, None), id="state-unread"),
        pytest.param(Answered({"mode": PCM_MODE}, None, ENUMERATIONS, None), id="attribute-unread"),
        pytest.param(Answered(STATE, None, None, None), id="enumerations-unread"),
        pytest.param(Answered(STATE, None, {"modes": ENUMERATIONS["modes"]}, None), id="filters-unread"),
    ],
)
def test_raw_filter_availability_changes_when_its_source_is_unread(unread: Answered) -> None:
    readable = view_of(STATE).raw_read("filter")
    unavailable = EngineView.of(unread).raw_read("filter")
    assert (unavailable is None) != (readable is None)


# Break: accept an enum ID or out-of-range index as a listed State index.
@pytest.mark.parametrize("unlisted_index", ["47", "8"])
def test_raw_filter_availability_changes_when_its_state_index_is_unlisted(unlisted_index: str) -> None:
    listed = view_of(STATE).raw_read("filter")
    unlisted = view_of({**STATE, "filterNx": unlisted_index}).raw_read("filter")
    assert (unlisted is None) != (listed is None)
