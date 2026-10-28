"""Composed settings preserve each store's domain, evidence and field policy."""

from dataclasses import replace
from typing import Literal

import pytest

from hqptuner.conf.formparse import parse_config_form, parse_matrix_form
from hqptuner.core.fieldreadings import config_reading
from hqptuner.core.fieldvalues import diverges, file_reading
from hqptuner.core.pending import PendingSnapshot
from hqptuner.core.readings import Readings
from hqptuner.fields import query
from hqptuner.fields.model import FileSelector

GENERATION = 7
FILE_GENERATION = 3
NEXT_GENERATION = 11
FIRST_ID = "31"
SECOND_ID = "47"
FIRST_INDEX = "0"
SECOND_INDEX = "1"
PCM_MODE = "2"
ENUMERATIONS = {
    "modes": [
        {"index": "0", "name": "SDM (DSD)", "value": "1"},
        {"index": "1", "name": "[source]", "value": "-1"},
        {"index": PCM_MODE, "name": "PCM", "value": "0"},
    ],
    "filters": [
        {"index": FIRST_INDEX, "name": "fixture-first", "value": FIRST_ID},
        {"index": SECOND_INDEX, "name": "fixture-second", "value": SECOND_ID},
    ],
}
EMPTY_PENDING = PendingSnapshot(live={}, http={})
FORM_LIMITS = '<input type="number" name="gain_comp" min="-13.5" max="7.25" step="0.125">'


def readings_of(index: str = SECOND_INDEX, file_value: str = FIRST_ID) -> Readings:
    readings = Readings()
    readings.take_engine(
        GENERATION,
        state={"mode": PCM_MODE, "filterNx": index, "filter1x": FIRST_INDEX},
        enums=ENUMERATIONS,
    )
    readings.take_file(
        generation=FILE_GENERATION,
        file_config={"filter": file_value, "oversampling": file_value, "title": "fixture-title"},
    )
    return readings


# Break: replace the lifecycle generation with a source acquisition generation.
@pytest.mark.parametrize("generation", [GENERATION, NEXT_GENERATION])
def test_response_generation_comes_from_the_lifecycle(generation: int) -> None:
    result = config_reading(readings_of(), EMPTY_PENDING, generation)
    assert result["generation"] == generation


# Break: normalize the Engine index into the File enum ID in the served reading.
@pytest.mark.parametrize("index", [FIRST_INDEX, SECOND_INDEX])
def test_engine_value_keeps_its_state_domain(index: str) -> None:
    result = config_reading(readings_of(index), EMPTY_PENDING, GENERATION)
    engine = result["fields"]["filter"]["engine"]
    assert engine is not None
    assert engine["value"] == index


# Break: choose the first enumeration label regardless of the selected Engine index.
@pytest.mark.parametrize(("index", "name"), [(FIRST_INDEX, "fixture-first"), (SECOND_INDEX, "fixture-second")])
def test_engine_name_follows_the_selected_wire_entry(index: str, name: str) -> None:
    result = config_reading(readings_of(index), EMPTY_PENDING, GENERATION)
    engine = result["fields"]["filter"]["engine"]
    assert engine is not None
    assert engine["name"] == name


# Break: use the lifecycle generation to freshen a retained Engine reading.
@pytest.mark.parametrize("generation", [GENERATION, NEXT_GENERATION])
def test_engine_stamp_remains_its_acquisition_generation(generation: int) -> None:
    result = config_reading(readings_of(), EMPTY_PENDING, generation)
    engine = result["fields"]["filter"]["engine"]
    assert engine is not None
    assert engine["generation"] == GENERATION


# Break: serve an Engine index or the conflicting form value as the archive File value.
@pytest.mark.parametrize("value", [FIRST_ID, SECOND_ID])
def test_archive_file_value_keeps_its_own_domain(value: str) -> None:
    readings = readings_of(file_value=value)
    readings.take_file(
        generation=GENERATION,
        config_form=parse_config_form('<form method="post"><input name="filter" value="99"></form>'),
    )
    result = config_reading(readings, EMPTY_PENDING, GENERATION)
    file = result["fields"]["filter"]["file"]
    assert file is not None
    assert file["value"] == value


# Break: restamp an old File value with the response or another source's generation.
@pytest.mark.parametrize("generation", [GENERATION, NEXT_GENERATION])
def test_file_stamp_remains_its_source_acquisition_generation(generation: int) -> None:
    result = config_reading(readings_of(), EMPTY_PENDING, generation)
    file = result["fields"]["filter"]["file"]
    assert file is not None
    assert file["generation"] == FILE_GENERATION


# Break: read Engine attributes from the archive instead of their own source.
@pytest.mark.parametrize("value", ["0", "1"])
def test_engine_attribute_file_value_uses_its_selected_source(value: str) -> None:
    readings = readings_of()
    readings.take_file(generation=GENERATION, engine={"cuda": value}, file_config={"cuda": "conflict"})
    result = config_reading(readings, EMPTY_PENDING, GENERATION)
    file = result["fields"]["cuda"]["file"]
    assert file is not None
    assert file["value"] == value


# Break: compare the State index directly with the archive enum ID.
@pytest.mark.parametrize(("value", "expected"), [(FIRST_ID, True), (SECOND_ID, False)])
def test_divergence_compares_stores_in_one_domain(value: str, *, expected: bool) -> None:
    result = config_reading(readings_of(file_value=value), EMPTY_PENDING, GENERATION)
    assert result["fields"]["filter"]["diverges"] is expected


# Break: serve held Engine evidence or leave its divergence after the Engine breaks.
@pytest.mark.parametrize("member", ["engine", "diverges"])
def test_engine_break_changes_current_evidence(member: Literal["engine", "diverges"]) -> None:
    readings = readings_of()
    before = config_reading(readings, EMPTY_PENDING, GENERATION)
    readings.break_engine()
    after = config_reading(readings, EMPTY_PENDING, GENERATION)
    assert after["fields"]["filter"][member] != before["fields"]["filter"][member]


# Break: make off-chain settings borrow the active chain's Engine evidence.
def test_off_chain_field_has_distinct_engine_evidence() -> None:
    result = config_reading(readings_of(), EMPTY_PENDING, GENERATION)
    assert result["fields"]["oversampling"]["engine"] != result["fields"]["filter"]["engine"]


# Break: display raw HTTP enum IDs, or preserve edits already held by Engine.
@pytest.mark.parametrize(("value", "expected"), [(FIRST_ID, FIRST_INDEX), (SECOND_ID, None)])
def test_staged_value_is_cleaned_and_projected(value: str, expected: str | None) -> None:
    pending = PendingSnapshot(live={}, http={"filter": value})
    result = config_reading(readings_of(), pending, GENERATION)
    assert result["fields"]["filter"]["staged"] == expected


# Break: replace a field's own policy with its companion's batch restart classification.
@pytest.mark.parametrize("name", ["filter", "title", "cuda", "matrix_enabled"])
def test_composition_uses_the_registered_field_policy(name: str) -> None:
    pending = PendingSnapshot(live={}, http={"title": "fixture-renamed", "filter": FIRST_ID})
    result = config_reading(readings_of(), pending, GENERATION)
    row = query.field(name)
    assert row is not None
    descriptor = row.read
    assert descriptor is not None
    served = result["fields"][name]
    assert (served["lane"], served["show"], served["restarts"]) == (
        descriptor.lane,
        descriptor.show,
        descriptor.restarts,
    )


# Break: include action-only fields alongside readable settings.
def test_composition_selects_settings_instead_of_actions() -> None:
    result = config_reading(readings_of(), EMPTY_PENDING, GENERATION)
    assert ("filter" in result["fields"], "matrix_profile_save" in result["fields"]) == (True, False)


# Break: permanently omit numeric fields instead of adding them when bounds arrive.
def test_numeric_setting_waits_for_complete_daemon_bounds() -> None:
    readings = readings_of()
    before = config_reading(readings, EMPTY_PENDING, GENERATION)
    readings.take_file(
        generation=GENERATION,
        config_form=parse_config_form(f'<form method="post">{FORM_LIMITS}</form>'),
    )
    after = config_reading(readings, EMPTY_PENDING, GENERATION)
    assert ("gain_comp" in before["fields"], "gain_comp" in after["fields"]) == (False, True)


# Break: replace daemon limits with static values while composing the response.
@pytest.mark.parametrize("maximum", [7.25, 19.5])
def test_composed_numeric_bounds_follow_daemon_evidence(maximum: float) -> None:
    readings = readings_of()
    html = FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"')
    readings.take_file(generation=GENERATION, config_form=parse_config_form(f'<form method="post">{html}</form>'))
    result = config_reading(readings, EMPTY_PENDING, GENERATION)
    bounds = result["fields"]["gain_comp"]["bounds"]
    assert bounds is not None
    assert bounds["max"] == maximum


# Break: substitute the lossy form for an archive source that has never been read.
@pytest.mark.parametrize("value", [FIRST_ID, SECOND_ID])
def test_archive_backed_field_waits_for_its_own_source(value: str) -> None:
    readings = Readings()
    readings.take_file(
        generation=GENERATION,
        config_form=parse_config_form('<form method="post"><input name="filter" value="99"></form>'),
    )
    before = config_reading(readings, EMPTY_PENDING, GENERATION)
    readings.take_file(generation=GENERATION, file_config={"filter": value})
    after = config_reading(readings, EMPTY_PENDING, GENERATION)
    assert (before["fields"]["filter"]["file"], after["fields"]["filter"]["file"]) == (
        None,
        {"value": value, "generation": GENERATION},
    )


# Break: manufacture an Engine value from File before Engine evidence arrives.
@pytest.mark.parametrize("index", [FIRST_INDEX, SECOND_INDEX])
def test_engine_reading_waits_for_its_own_evidence(index: str) -> None:
    readings = Readings()
    readings.take_file(generation=GENERATION, file_config={"filter": FIRST_ID})
    before = config_reading(readings, EMPTY_PENDING, GENERATION)
    readings.take_engine(GENERATION, state={"mode": PCM_MODE, "filterNx": index}, enums=ENUMERATIONS)
    after = config_reading(readings, EMPTY_PENDING, GENERATION)
    engine = after["fields"]["filter"]["engine"]
    assert engine is not None
    assert (before["fields"]["filter"]["engine"], engine["value"]) == (None, index)


# Break: clear retained File display while its source awaits a fresh acquisition.
@pytest.mark.parametrize("value", [FIRST_ID, SECOND_ID])
def test_file_value_survives_refresh_without_becoming_a_new_acquisition(value: str) -> None:
    readings = readings_of(file_value=value)
    readings.break_file("file_config")
    readings.take_engine(NEXT_GENERATION, state={"mode": PCM_MODE, "filterNx": SECOND_INDEX})
    result = config_reading(readings, EMPTY_PENDING, NEXT_GENERATION)
    assert result["fields"]["filter"]["file"] == {"value": value, "generation": FILE_GENERATION}


# Break: join a new State selection to an enumeration retained from an old Engine view.
@pytest.mark.parametrize("index", [FIRST_INDEX, SECOND_INDEX])
def test_engine_reading_waits_for_matching_input_generations(index: str) -> None:
    readings = readings_of()
    readings.take_engine(NEXT_GENERATION, state={"mode": PCM_MODE, "filterNx": index})
    before = config_reading(readings, EMPTY_PENDING, NEXT_GENERATION)
    readings.take_engine(NEXT_GENERATION, enums=ENUMERATIONS)
    after = config_reading(readings, EMPTY_PENDING, NEXT_GENERATION)
    engine = after["fields"]["filter"]["engine"]
    assert engine is not None
    assert (before["fields"]["filter"]["engine"], engine["value"]) == (None, index)


# Break: choose the archive or another form instead of the descriptor's form and stamp.
@pytest.mark.parametrize("source", ["config_form", "matrix_form"])
@pytest.mark.parametrize("value", ["-2.5", "4.25"])
def test_file_selection_uses_the_descriptors_form_source(
    source: Literal["config_form", "matrix_form"], value: str
) -> None:
    row = query.field("gain_comp")
    assert row is not None
    descriptor = row.read
    assert descriptor is not None
    selected = replace(row, read=replace(descriptor, file=FileSelector(source, "gain_comp")))
    readings = Readings()
    conflicting = '<form method="post"><input name="gain_comp" value="99"></form>'
    readings.take_file(
        generation=GENERATION,
        file_config={"gain_comp": "88"},
        config_form=parse_config_form(conflicting),
        matrix_form=parse_matrix_form(conflicting),
    )
    html = f'<form method="post"><input name="gain_comp" value="{value}"></form>'
    if source == "config_form":
        readings.take_file(generation=FILE_GENERATION, config_form=parse_config_form(html))
    else:
        readings.take_file(generation=FILE_GENERATION, matrix_form=parse_matrix_form(html))
    assert file_reading(readings, selected) == {"value": value, "generation": FILE_GENERATION}


# Break: compare equivalent numeric representations as unequal strings.
@pytest.mark.parametrize(("engine", "file", "expected"), [("02", "2", False), ("2", "3", True)])
def test_numeric_divergence_compares_values_in_the_numeric_domain(engine: str, file: str, *, expected: bool) -> None:
    row = query.field("nblocks")
    assert row is not None
    assert diverges(row, engine, file) is expected


# Break: treat missing or malformed numeric evidence as a comparable disagreement.
@pytest.mark.parametrize(("engine", "file"), [(None, "3"), ("2", None), ("invalid", "3"), ("2", "invalid")])
def test_incomparable_numeric_evidence_cannot_report_divergence(engine: str | None, file: str | None) -> None:
    row = query.field("nblocks")
    assert row is not None
    assert (diverges(row, "2", "3"), diverges(row, engine, file)) == (True, False)


# Break: erase a global live edit using retained State while serving its Engine store unread.
@pytest.mark.parametrize("value", ["0", "1"])
def test_unread_engine_evidence_cannot_clear_a_staged_edit(value: str) -> None:
    readings = Readings()
    readings.take_engine(GENERATION, state={"adaptive": value}, enums=ENUMERATIONS)
    pending = PendingSnapshot(live={"adaptive_volume": {"value": value}}, http={})
    readings.take_engine(NEXT_GENERATION, enums=ENUMERATIONS)
    result = config_reading(readings, pending, NEXT_GENERATION)
    field = result["fields"]["adaptive_volume"]
    assert (field["engine"], field["staged"]) == (None, value)
