"""The drop report: what the Engine ran before an outcome and does not run after it.

The report compares two stamped Engine readings, the last verified one before the outcome
and the first verified one after it, and replays nothing (`docs/spec/settings-truth.md`
rules 6 and 8). A field goes on it by its config-form name with the value the Engine held
before, named the way the enumeration names it. A field of a chain the after-reading has
not loaded has no Engine value there, so nothing says it was dropped (rule 10).

Each reading is a table in the shapes the Control API answers in, with the enumerations of
`tests/support/fake_control.py`: the PCM filter list carries `sinc-M` at index 2 as enum ID
25, the PCM shaper list `NS9` at index 1 as enum ID 5, the junk filter list `20k` at index 1.
The after-reading is the engine back on its config file, every setting on index 0.
"""

from types import MappingProxyType
from typing import NamedTuple

import pytest

from hqptuner.core.readings import EngineSnapshot, Source, Stamp
from hqptuner.lanes.live.dropped import Dropped, report

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "SDM (DSD)", "value": "1"},
]
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
JUNK_FILTERS = [{"index": "0", "name": "none"}, {"index": "1", "name": "20k"}, {"index": "2", "name": "30k"}]
PCM_RATES = [{"index": "0", "rate": "0"}, {"index": "1", "rate": "44100"}, {"index": "2", "rate": "352800"}]
SDM_RATES = [{"index": "0", "rate": "0"}, {"index": "1", "rate": "2822400"}]


class Chain(NamedTuple):
    """One loaded chain: its State mode index, the mode Status names, and its enumerations."""

    mode: str
    active_mode: str
    enums: dict[str, list[dict[str, str]]]


PCM = Chain(
    "1",
    "PCM",
    {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS, "junk_filters": JUNK_FILTERS, "rates": PCM_RATES},
)
SDM = Chain(
    "2",
    "SDM (DSD)",
    {"modes": MODES, "filters": SDM_FILTERS, "shapers": SDM_SHAPERS, "junk_filters": JUNK_FILTERS, "rates": SDM_RATES},
)

#: The generation of the last verified reading before the outcome, and of the first one after it.
BEFORE_GENERATION = 3
AFTER_GENERATION = 4

#: The State the config file brings the engine up on: every setting on index 0.
CONFIG_FILE_STATE = MappingProxyType(
    {"state": "0", "filter1x": "0", "filterNx": "0", "shaper": "0", "rate": "0", "filter_junk": "0", "adaptive": "0"}
)


def _reading(generation: int, chain: Chain, moved: dict[str, str]) -> EngineSnapshot:
    """The Engine on ``chain`` with the config file's State, ``moved`` written over it."""
    state = {**CONFIG_FILE_STATE, "mode": chain.mode, **moved}
    status = {"state": "0", "active_mode": chain.active_mode}
    return EngineSnapshot(Stamp(Source.ENGINE, generation), state=state, status=status, enums=chain.enums)


def _fields(dropped: tuple[Dropped, ...]) -> set[str]:
    return {entry.field for entry in dropped}


class Held(NamedTuple):
    """A field the Engine ran off the config file before the outcome: the State it moved,
    the enumeration's name for it and its config-form value."""

    field: str
    moved: dict[str, str]
    name: str | None
    value: str


SINC_M = Held("filter", {"filterNx": "2"}, "sinc-M", "25")
NS9 = Held("dither", {"shaper": "1"}, "NS9", "5")
JUNK_20K = Held("junk_filter", {"filter_junk": "1"}, "20k", "1")
ADAPTIVE_ON = Held("adaptive_volume", {"adaptive": "1"}, None, "1")

#: Each field the Engine no longer holds after the outcome, beside one it ran off the
#: config file before and still runs after.
MOVES = {
    "filter": (SINC_M, NS9),
    "dither": (NS9, JUNK_20K),
    "junk_filter": (JUNK_20K, ADAPTIVE_ON),
    "adaptive_volume": (ADAPTIVE_ON, SINC_M),
}
NAMED = {"filter": SINC_M, "dither": NS9, "junk_filter": JUNK_20K}
CHAIN_FIELDS = {"filter": SINC_M, "dither": NS9}


@pytest.mark.parametrize(("held", "kept"), MOVES.values(), ids=MOVES.keys())
def test_only_the_field_the_engine_no_longer_holds_is_reported(held: Held, kept: Held) -> None:
    before = _reading(BEFORE_GENERATION, PCM, {**held.moved, **kept.moved})
    after = _reading(AFTER_GENERATION, PCM, kept.moved)
    assert _fields(report(before, after)) == {held.field}


@pytest.mark.parametrize("held", NAMED.values(), ids=NAMED.keys())
def test_a_dropped_field_is_named_as_the_engine_ran_it_before(held: Held) -> None:
    before = _reading(BEFORE_GENERATION, PCM, held.moved)
    after = _reading(AFTER_GENERATION, PCM, {})
    assert [entry.name for entry in report(before, after) if entry.field == held.field] == [held.name]


@pytest.mark.parametrize("held", CHAIN_FIELDS.values(), ids=CHAIN_FIELDS.keys())
def test_a_dropped_chain_field_carries_the_enum_id_the_engine_ran_before(held: Held) -> None:
    before = _reading(BEFORE_GENERATION, PCM, held.moved)
    after = _reading(AFTER_GENERATION, PCM, {})
    assert [entry.value for entry in report(before, after) if entry.field == held.field] == [held.value]


def test_a_field_of_a_chain_the_after_reading_has_not_loaded_is_not_reported() -> None:
    # Before: PCM loaded, its filter and shaper off the config file. After: SDM loaded,
    # whose State indices say nothing about the PCM chain, so only the mode is gone.
    before = _reading(BEFORE_GENERATION, PCM, {**SINC_M.moved, **NS9.moved})
    after = _reading(AFTER_GENERATION, SDM, {})
    assert _fields(report(before, after)) == {"mode"}
