"""Coverage of ``metadata_json``'s narrowing functions off their own defensive edges.

Every function here drops a field, or an entry, or a whole document, rather than
trust a shape it does not recognize. Each test drives the "not the shape
expected" leg of one guard — a non-dict where a dict is expected, a
JSON-incompatible value nested inside a document, and the one string field
(``sdm_two_stage_note``) ``filter_entry`` carries. One assertion each
(docs/testing.md rule 2).
"""

from __future__ import annotations

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


def test_filter_entry_on_a_non_dict_raw_value_is_empty() -> None:
    assert (filter_entry("not a mapping"), filter_entry({"quality": 3})) == ({}, {"quality": 3})


def test_filter_entry_keeps_a_well_formed_sdm_two_stage_note() -> None:
    assert filter_entry({"sdm_two_stage_note": "shares the base filter's note"}) == {
        "sdm_two_stage_note": "shares the base filter's note"
    }


def test_filter_entry_map_on_a_non_dict_value_is_empty() -> None:
    assert (filter_entry_map(["not", "a", "mapping"]), filter_entry_map({"poly-sinc": {"quality": 3}})) == (
        {},
        {"poly-sinc": {"quality": 3}},
    )


def test_shaper_entry_on_a_non_dict_raw_value_is_empty() -> None:
    entry = {"min_rate_hz": None, "max_rate_hz": None, "order": 7}
    assert (shaper_entry(42), shaper_entry(entry)) == ({}, entry)


def test_shaper_entry_map_on_a_non_dict_value_is_empty() -> None:
    entry = {"min_rate_hz": None, "max_rate_hz": None, "order": 7}
    assert (shaper_entry_map(None), shaper_entry_map({"ASDM7": entry})) == ({}, {"ASDM7": entry})


def test_settings_db_drops_a_group_entry_whose_own_value_is_not_a_mapping() -> None:
    assert settings_db({"output": {"gain": "not a mapping"}}).output == {"gain": {}}


def test_plain_name_entry_on_a_non_dict_raw_value_is_empty() -> None:
    entry = {"family": "sinc", "variant": None}
    assert (plain_name_entry(()), plain_name_entry(entry)) == ({}, entry)


def test_plain_name_entry_map_on_a_non_dict_value_is_empty() -> None:
    entry = {"family": "sinc", "variant": None}
    assert (plain_name_entry_map(1), plain_name_entry_map({"sinc-M": entry})) == ({}, {"sinc-M": entry})


def test_filters_db_on_a_non_dict_raw_value_still_carries_an_empty_filters_table() -> None:
    assert filters_db("not a mapping") == {"filters": {}}


def test_shapers_db_on_a_non_dict_raw_value_still_carries_empty_tables() -> None:
    tables = {
        "sdm_modulators": {"ASDM7": {"min_rate_hz": None, "max_rate_hz": None, "order": 7}},
        "pcm_dithers": {"TPDF": {"min_rate_hz": None, "max_rate_hz": None, "order": 1}},
    }
    absent = shapers_db(3.5)
    present = shapers_db(tables)
    assert ((absent.sdm_modulators, absent.pcm_dithers), (present.sdm_modulators, present.pcm_dithers)) == (
        ({}, {}),
        (tables["sdm_modulators"], tables["pcm_dithers"]),
    )


def test_easy_db_drops_a_value_holding_a_json_incompatible_nested_type() -> None:
    assert (easy_db({"a": {1, 2}}), easy_db({"a": [1, 2]})) == ({}, {"a": [1, 2]})
