"""Form parser behavior against a captured live 6.0.4 /config page.

Policy: docs/testing.md — one condition per test, behavior only.
"""

import re
from pathlib import Path

import pytest

from hqptuner.conf.httpconf import parse_config_form

FIXTURE = Path(__file__).parent / "fixtures" / "config-form-6.0.4.html"
_HTML = FIXTURE.read_text()
_PARSED = parse_config_form(_HTML)
_FIELDS = {f["name"]: f for f in _PARSED["fields"]}

# the outline §4 persistent controls the read side must surface
OWNED_FIELDS = {
    "backend",
    "mode",
    "channels",
    "pipelines",
    "fft_size",
    "idle_time",
    "net_ipv6",
    "net_anydsd",
    "fixed_volume_enabled",
    "fixed_volume",
    "volume_max",
    "volume_min",
    "defaults_volume",
    "gain_comp",
    "adaptive_volume",
    "playlist_album_gain",
}


def test_all_owned_persistent_controls_are_parsed() -> None:
    assert set(_FIELDS) >= OWNED_FIELDS


def test_select_reports_the_selected_option() -> None:
    assert _FIELDS["backend"]["value"] == "network"


def test_select_carries_every_option() -> None:
    assert {o["value"] for o in _FIELDS["backend"]["options"]} == {"alsa", "network", "combo"}


def test_number_field_carries_min_max_constraints() -> None:
    assert (_FIELDS["channels"]["min"], _FIELDS["channels"]["max"]) == (2, 32)


def test_number_field_carries_step_constraint() -> None:
    assert _FIELDS["gain_comp"]["step"] == 0.1


def test_checked_checkbox_parses_true() -> None:
    assert _FIELDS["volume_fixed"]["value"] is True


def test_unchecked_checkbox_parses_false() -> None:
    assert _FIELDS["fixed_volume_enabled"]["value"] is False


def test_text_field_reports_current_value() -> None:
    assert _FIELDS["title"]["value"] == "Opal"


def test_profile_list_includes_the_default_base_configuration() -> None:
    assert any(o["value"] == "" for o in _PARSED["profiles"]["options"])


def _raw_wire_value(name: str, ftype: str) -> object:
    """Independent extraction from the raw document (not via the parser)."""
    if ftype == "select":
        block = re.search(rf'<select name="{name}".*?</select>', _HTML, re.S).group(0)
        selected = re.search(r'<option value="([^"]*)"[^>]*\bselected\b', block)
        if selected:
            return selected.group(1)
        return re.search(r'<option value="([^"]*)"', block).group(1)
    tag = re.search(rf'<input[^>]*name="{name}"[^>]*/?>', _HTML).group(0)
    if ftype == "checkbox":
        return " checked" in tag
    value = re.search(r'value="([^"]*)"', tag)
    raw = value.group(1) if value else ""
    return float(raw) if ftype == "number" else raw


@pytest.mark.parametrize("name", sorted(_FIELDS), ids=str)
def test_parsed_value_matches_raw_document(name: str) -> None:
    field = _FIELDS[name]
    expected = _raw_wire_value(name, field["type"])
    actual = float(field["value"]) if field["type"] == "number" else field["value"]
    assert actual == expected
