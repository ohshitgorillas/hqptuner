"""Coverage of ``metadata_json``'s narrowing functions off their own defensive edges.

Every function here drops a field, or an entry, or a whole document, rather than
trust a shape it does not recognize. Each test drives the "not the shape
expected" leg of one guard — a non-dict where a dict is expected, a
JSON-incompatible value nested inside a document, and the one string field
(``sdm_two_stage_note``) ``filter_entry`` carries.
"""

from __future__ import annotations

import pytest

from hqptuner.metadata_json import (
    easy_db,
    filter_entry,
    filter_entry_map,
    filters_db,
    plain_name_entry,
    plain_name_entry_map,
    settings_db,
    shaper_entry,
    shaper_entry_map,
    shapers_db,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("not a mapping", {}), ({"quality": 3}, {"quality": 3})],
    ids=["non-dict", "dict"],
)
def test_filter_entry_on_a_non_dict_raw_value_is_empty_and_on_a_dict_keeps_its_fields(
    raw: object, expected: object
) -> None:
    assert filter_entry(raw) == expected


def test_filter_entry_keeps_a_well_formed_sdm_two_stage_note() -> None:
    assert filter_entry({"sdm_two_stage_note": "shares the base filter's note"}) == {
        "sdm_two_stage_note": "shares the base filter's note"
    }


#: The overlay fields the narrowing store and the prose reader take off a served
#: filter entry, each with a value of the type it expects.
FILTER_FACET_FIELDS = [
    ("phase", "linear"),
    ("upsample_only", True),
    ("length", "long"),
    ("adaptive", True),
    ("ratio_pcm", "2x"),
    ("ratio_sdm", "any"),
    ("notes", "shares the base filter's taps"),
]


@pytest.mark.parametrize(("key", "value"), FILTER_FACET_FIELDS, ids=[key for key, _ in FILTER_FACET_FIELDS])
def test_filter_entry_keeps_a_facet_field_the_narrowing_store_reads(key: str, value: object) -> None:
    assert filter_entry({key: value}) == {key: value}


def test_filter_entry_drops_an_upsample_only_that_is_not_a_bool_and_keeps_its_neighbor() -> None:
    assert filter_entry({"upsample_only": "yes", "length": "long"}) == {"length": "long"}


#: A shaper entry always carries both rate bounds, ``None`` where the overlay states none.
UNBOUNDED_RATES = {"min_rate_hz": None, "max_rate_hz": None}


@pytest.mark.parametrize(("key", "value"), [("min_rate_label", "DSD256"), ("notes", "fifth-order variant")])
def test_shaper_entry_keeps_a_field_the_prose_reads(key: str, value: str) -> None:
    assert shaper_entry({key: value}) == {**UNBOUNDED_RATES, key: value}


def test_shaper_entry_drops_a_rate_label_that_is_not_a_string() -> None:
    assert shaper_entry({"min_rate_label": 256}) == UNBOUNDED_RATES


@pytest.mark.parametrize(
    ("value", "expected"),
    [(["not", "a", "mapping"], {}), ({"poly-sinc": {"quality": 3}}, {"poly-sinc": {"quality": 3}})],
    ids=["non-dict", "dict"],
)
def test_filter_entry_map_on_a_non_dict_value_is_empty_and_on_a_dict_keeps_its_entries(
    value: object, expected: object
) -> None:
    assert filter_entry_map(value) == expected


#: A well-formed shaper entry, every field it carries already in the shape ``shaper_entry`` keeps.
SHAPER_ENTRY = {"min_rate_hz": None, "max_rate_hz": None, "order": 7}


@pytest.mark.parametrize(("raw", "expected"), [(42, {}), (SHAPER_ENTRY, SHAPER_ENTRY)], ids=["non-dict", "dict"])
def test_shaper_entry_on_a_non_dict_raw_value_is_empty_and_on_a_dict_keeps_its_fields(
    raw: object, expected: object
) -> None:
    assert shaper_entry(raw) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, {}), ({"ASDM7": SHAPER_ENTRY}, {"ASDM7": SHAPER_ENTRY})],
    ids=["non-dict", "dict"],
)
def test_shaper_entry_map_on_a_non_dict_value_is_empty_and_on_a_dict_keeps_its_entries(
    value: object, expected: object
) -> None:
    assert shaper_entry_map(value) == expected


def test_settings_db_drops_a_group_entry_whose_own_value_is_not_a_mapping() -> None:
    assert settings_db({"output": {"gain": "not a mapping"}}).output == {"gain": {}}


#: A well-formed plain-name entry, every field it carries already in the shape ``plain_name_entry`` keeps.
PLAIN_NAME_ENTRY = {"family": "sinc", "variant": None}


@pytest.mark.parametrize(
    ("raw", "expected"), [((), {}), (PLAIN_NAME_ENTRY, PLAIN_NAME_ENTRY)], ids=["non-dict", "dict"]
)
def test_plain_name_entry_on_a_non_dict_raw_value_is_empty_and_on_a_dict_keeps_its_fields(
    raw: object, expected: object
) -> None:
    assert plain_name_entry(raw) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(1, {}), ({"sinc-M": PLAIN_NAME_ENTRY}, {"sinc-M": PLAIN_NAME_ENTRY})],
    ids=["non-dict", "dict"],
)
def test_plain_name_entry_map_on_a_non_dict_value_is_empty_and_on_a_dict_keeps_its_entries(
    value: object, expected: object
) -> None:
    assert plain_name_entry_map(value) == expected


def test_filters_db_on_a_non_dict_raw_value_still_carries_an_empty_filters_table() -> None:
    assert filters_db("not a mapping") == {"filters": {}}


#: A well-formed ``shapers.json`` document, both per-mode tables populated.
SHAPER_TABLES = {
    "sdm_modulators": {"ASDM7": {"min_rate_hz": None, "max_rate_hz": None, "order": 7}},
    "pcm_dithers": {"TPDF": {"min_rate_hz": None, "max_rate_hz": None, "order": 1}},
}


@pytest.mark.parametrize(
    ("raw", "expected"), [(3.5, {}), (SHAPER_TABLES, SHAPER_TABLES["sdm_modulators"])], ids=["non-dict", "dict"]
)
def test_shapers_db_on_a_non_dict_raw_value_still_carries_an_empty_sdm_modulators_table(
    raw: object, expected: object
) -> None:
    assert shapers_db(raw).sdm_modulators == expected


@pytest.mark.parametrize(
    ("raw", "expected"), [(3.5, {}), (SHAPER_TABLES, SHAPER_TABLES["pcm_dithers"])], ids=["non-dict", "dict"]
)
def test_shapers_db_on_a_non_dict_raw_value_still_carries_an_empty_pcm_dithers_table(
    raw: object, expected: object
) -> None:
    assert shapers_db(raw).pcm_dithers == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [({"a": {1, 2}}, {}), ({"a": [1, 2]}, {"a": [1, 2]})],
    ids=["json-incompatible nested set", "json-compatible nested list"],
)
def test_easy_db_drops_a_value_holding_a_json_incompatible_nested_type(raw: object, expected: object) -> None:
    assert easy_db(raw) == expected
