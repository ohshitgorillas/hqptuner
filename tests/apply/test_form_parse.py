"""Form parser behavior against a captured live 6.0.4 /config page.

Policy: docs/testing.md — one condition per test, behavior only.
"""

import re
from pathlib import Path

import pytest
from bs4 import BeautifulSoup
from narrow import present

from hqptuner.conf import fixedvol, presetconf
from hqptuner.conf.formparse import MATRIX_ROW_RE, attr, grouped_fields, parse_config_form, parse_matrix_form
from hqptuner.conf.httpforms import FormField

FIXTURE = Path(__file__).parent.parent / "support" / "fixtures" / "config-form-6.0.4.html"
_HTML = FIXTURE.read_text()
_PARSED = parse_config_form(_HTML)
_FIELDS = {f["name"]: f for f in _PARSED["fields"] if f["name"] is not None}

# Every /config field the persistent write path can target, derived from
# presetconf rather than hand-listed — a hand-kept subset (this was 16 of 48)
# stops covering the fields added after someone last remembered to widen it.
# The offline half of the version canary: this catches a parser regression
# against the frozen 6.0.4 capture, test_live_forms catches the daemon moving
# under us. post_*/matrix_* live on the /matrix form, not this one.
OWNED_FIELDS = {
    name
    for name in set(presetconf.FIELD_MAP) | {presetconf.NET_DEVICE, fixedvol.FIXED_ENABLED, fixedvol.FIXED_LEVEL}
    if not name.startswith(("post_", "matrix_"))
}


def test_all_owned_persistent_controls_are_parsed() -> None:
    assert set(_FIELDS) >= OWNED_FIELDS


def test_select_reports_the_selected_option() -> None:
    assert _FIELDS["backend"]["value"] == "network"


def test_select_carries_every_option() -> None:
    assert {o["value"] for o in _FIELDS["backend"]["options"]} == {"alsa", "network", "combo"}


def test_number_field_carries_min_constraint() -> None:
    assert _FIELDS["channels"]["min"] == 2


def test_number_field_carries_max_constraint() -> None:
    assert _FIELDS["channels"]["max"] == 32


def test_number_field_carries_step_constraint() -> None:
    assert _FIELDS["gain_comp"]["step"] == 0.1


@pytest.mark.parametrize(
    ("name", "expected"),
    [("fixed_volume_enabled", False), ("volume_fixed", True)],
    ids=["unchecked", "checked"],
)
def test_a_checkbox_parses_checked_as_true_and_unchecked_as_false(name: str, *, expected: bool) -> None:
    assert _FIELDS[name]["value"] is expected


def test_text_field_reports_current_value() -> None:
    assert _FIELDS["title"]["value"] == "Opal"


def test_profile_list_includes_the_default_base_configuration() -> None:
    assert "" in [o["value"] for o in present(_PARSED["profiles"])["options"]]


def _raw_wire_value(name: str, ftype: str) -> object:
    """Independent extraction from the raw document (not via the parser)."""
    if ftype == "select":
        block = present(re.search(rf'<select name="{name}".*?</select>', _HTML, re.DOTALL)).group(0)
        selected = re.search(r'<option value="([^"]*)"[^>]*\bselected\b', block)
        if selected:
            return selected.group(1)
        return present(re.search(r'<option value="([^"]*)"', block)).group(1)
    tag = present(re.search(rf'<input[^>]*name="{name}"[^>]*/?>', _HTML)).group(0)
    if ftype == "checkbox":
        return " checked" in tag
    value = re.search(r'value="([^"]*)"', tag)
    raw = value.group(1) if value else ""
    return float(raw) if ftype == "number" else raw


@pytest.mark.parametrize("name", sorted(_FIELDS), ids=str)
def test_parsed_value_matches_raw_document(name: str) -> None:
    field = _FIELDS[name]
    assert field["value"] == _raw_wire_value(name, field["type"])


def test_a_number_input_in_exponent_notation_parses_as_a_float() -> None:
    html = '<form method="post"><input type="number" name="n" value="2.5E-3"></form>'
    assert parse_config_form(html)["fields"][0]["value"] == 0.0025


def test_grouped_fields_places_the_third_matrix_row_field_under_index_2() -> None:
    fields = [FormField(name="source_0"), FormField(name="source_1"), FormField(name="source_2")]
    row2 = grouped_fields(fields, MATRIX_ROW_RE)[2]
    assert {f.get("name") for f in row2.values()} == {"source_2"}


@pytest.mark.parametrize(
    ("attrs", "key", "expected"),
    [("", "value", None), ('value=""', "value", ""), ('step="any"', "step", "any")],
    ids=["no value attribute", "empty value", "step any"],
)
def test_a_number_input_keeps_a_value_or_step_that_is_not_a_number_as_the_page_wrote_it(
    attrs: str, key: str, expected: str | None
) -> None:
    html = f'<form method="post"><input type="number" name="n" {attrs}></form>'
    assert parse_config_form(html)["fields"][0].get(key) == expected


def test_a_multi_valued_attribute_reads_as_its_values_joined_by_spaces() -> None:
    tag = present(BeautifulSoup('<input class="wide dark">', "html.parser").select_one("input"))
    assert attr(tag, "class") == "wide dark"


@pytest.mark.parametrize(
    ("page", "active"),
    [
        ("<b>Note</b> text <b>Active: </b>Night", "Night"),
        ("<b>Active: </b><i>Night</i>", ""),
    ],
    ids=["another bold label first", "name inside an element"],
)
def test_the_matrix_form_reads_the_active_profile_from_the_text_after_its_label(page: str, active: str) -> None:
    assert parse_matrix_form(f'<form method="post">{page}</form>')["active"] == active


@pytest.mark.parametrize(
    ("columns", "rows"),
    [
        ('<input name="source_0" value="1"><input type="checkbox" name="plot_0">', [{"index": 0, "source": "1"}]),
        ('<input type="checkbox" name="plot_0"><input type="file" name="filter_0">', []),
    ],
    ids=["a value column beside the toggle", "client-side columns only"],
)
def test_the_matrix_form_has_a_row_only_where_a_value_bearing_column_exists(
    columns: str, rows: list[dict[str, object]]
) -> None:
    assert parse_matrix_form(f'<form method="post">{columns}</form>')["rows"] == rows
