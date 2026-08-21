"""Input validation on the matrix config-form fields.

Characterization of behavior that already exists: ``matrix_pipelines`` and
``matrix_profile_save`` arrive as JSON strings off a config form, and every
malformed shape is refused with a ``GroundingError`` before any XML is written.
The snapshots come from the fake daemon's own config renderer, so the validators
are exercised against 6.0.4-shaped documents, and the accepted side is read back
by an independent regex over the ``<matrix>`` body rather than through the
writer under test.

The field-name prefixes are read off the module's public constants. The profile
name-length ceiling is *not* exported as a constant, so ``NAME_MAX`` below
restates the contract value the code's own message names ("longer than 128
characters"); if that ceiling ever moves, this constant moves with it.
"""

import json
import re
from collections.abc import Callable
from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import matrixconf
from hqptuner.conf.xmledit import GroundingError

PIPE = matrixconf.MATRIX_PIPELINES
SAVE = matrixconf.MATRIX_PROFILE_SAVE

#: The profile-name ceiling. See the module docstring: no public constant.
NAME_MAX = 128

#: The pipeline-row ceiling.
ROWS_MAX = 128

ROW = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}


def cfg() -> bytes:
    """A 6.0.4-shaped config snapshot as the fake daemon renders one."""
    return cfg_xml(state())


def rooted_without_matrix() -> bytes:
    """The same snapshot with its live ``<matrix>`` element excised. The negative
    lookahead keeps ``<matrix_profile>`` elements intact."""
    return re.sub(rb"<matrix\b(?![_a-z]).*?</matrix>", b"", cfg(), flags=re.DOTALL)


def matrix_body(xml: bytes) -> bytes:
    """The live ``<matrix>`` element's body, read back independently of the
    writer. ``<matrix_profile>`` does not match ``<matrix\\b``, so a stored
    profile's rows never leak in here."""
    m = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.DOTALL)
    return m.group(1) if m else b""


def pipelines(value: Any) -> bytes:
    """Stage a ``matrix_pipelines`` value; a str goes through verbatim so a
    malformed-JSON case can be expressed."""
    return matrixconf.replace_pipelines(cfg(), value if isinstance(value, str) else json.dumps(value))


def rows(*extra: dict[str, Any]) -> list[dict[str, Any]]:
    """A row list of one row, the given overrides applied."""
    return [{**ROW, **e} for e in extra] or [ROW]


def profile(payload: Any) -> bytes:
    """Stage a ``matrix_profile_save`` value against a valid snapshot."""
    return matrixconf.write_profile(cfg(), payload if isinstance(payload, str) else json.dumps(payload))


def save_payload(**overrides: Any) -> dict[str, Any]:
    return {"name": "Crossfeed EQ", "rows": [ROW], **overrides}


#: The two entry points that read a whole save payload.
SAVE_ENTRIES = [
    pytest.param(profile, id="write_profile"),
    pytest.param(matrixconf.save_targets, id="save_targets"),
]


# --- 1. a row that is not an object ------------------------------------------


def test_a_row_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(GroundingError):
        pipelines(["not a dict"])


def test_a_row_that_is_not_an_object_says_each_row_must_be_an_object() -> None:
    with pytest.raises(GroundingError, match=f"{PIPE}: each row must be an object"):
        pipelines(["not a dict"])


# --- 2. source/mixdown missing or not an integer ------------------------------

NON_INTEGER_ROWS = [
    pytest.param({"mixdown": 0}, id="source-missing"),
    pytest.param({"source": 0}, id="mixdown-missing"),
    pytest.param({"source": None, "mixdown": 0}, id="source-null"),
    pytest.param({"source": 0, "mixdown": None}, id="mixdown-null"),
    pytest.param({"source": "left", "mixdown": 0}, id="source-non-numeric"),
    pytest.param({"source": 0, "mixdown": "right"}, id="mixdown-non-numeric"),
]


@pytest.mark.parametrize("row", NON_INTEGER_ROWS)
def test_a_row_without_integer_source_and_mixdown_is_refused(row: dict[str, Any]) -> None:
    with pytest.raises(GroundingError):
        pipelines([row])


@pytest.mark.parametrize("row", NON_INTEGER_ROWS)
def test_a_row_without_integer_source_and_mixdown_says_they_must_be_integers(row: dict[str, Any]) -> None:
    with pytest.raises(GroundingError, match=f"{PIPE}: source/mixdown must be integers"):
        pipelines([row])


# --- 3. source/mixdown out of the 0..127 channel range ------------------------

OUT_OF_RANGE_ROWS = [
    pytest.param({"source": 128, "mixdown": 0}, id="source-above-top"),
    pytest.param({"source": -1, "mixdown": 0}, id="source-negative"),
    pytest.param({"source": 0, "mixdown": 128}, id="mixdown-above-top"),
    pytest.param({"source": 0, "mixdown": -1}, id="mixdown-negative"),
]


@pytest.mark.parametrize("row", OUT_OF_RANGE_ROWS)
def test_a_channel_outside_the_matrix_range_is_refused(row: dict[str, Any]) -> None:
    with pytest.raises(GroundingError):
        pipelines([row])


@pytest.mark.parametrize("row", OUT_OF_RANGE_ROWS)
def test_a_channel_outside_the_matrix_range_says_out_of_range_0_to_127(row: dict[str, Any]) -> None:
    with pytest.raises(GroundingError, match=re.escape(f"{PIPE}: source/mixdown out of range 0..127")):
        pipelines([row])


def test_the_top_channel_of_the_range_is_accepted() -> None:
    assert b'source="127"' in matrix_body(pipelines(rows({"source": 127, "mixdown": 127})))


# --- 4. gainunit --------------------------------------------------------------


def test_a_gain_unit_that_is_neither_db_nor_lin_is_refused() -> None:
    with pytest.raises(GroundingError):
        pipelines(rows({"gainunit": "dBFS"}))


def test_a_bad_gain_unit_is_named_in_the_message() -> None:
    with pytest.raises(GroundingError, match=f"{PIPE}: bad gainunit 'dBFS'"):
        pipelines(rows({"gainunit": "dBFS"}))


def test_a_decibel_gain_is_written_bare_on_the_pipeline_row() -> None:
    # <pipeline gain> is the only gain attribute the wire has (readme §1.11.1);
    # "dB" is the wire's own unit, so the number goes out as given
    assert b'gain="-3.5"' in matrix_body(pipelines(rows({"gainunit": "dB", "gain": "-3.5"})))


def test_a_linear_gain_is_written_with_its_own_marker() -> None:
    assert b'gain="L2"' in matrix_body(pipelines(rows({"gainunit": "Lin", "gain": "2"})))


# --- 5. gain ------------------------------------------------------------------

BAD_GAINS = ["loud", "1e3", "+2", "3 dB", ""]


@pytest.mark.parametrize("gain", BAD_GAINS)
def test_a_gain_outside_the_accepted_number_format_is_refused(gain: str) -> None:
    with pytest.raises(GroundingError):
        pipelines(rows({"gain": gain}))


@pytest.mark.parametrize("gain", BAD_GAINS)
def test_a_bad_gain_is_named_in_the_message(gain: str) -> None:
    with pytest.raises(GroundingError, match=re.escape(f"{PIPE}: bad gain '{gain}'")):
        pipelines(rows({"gain": gain}))


@pytest.mark.parametrize("gain", ["0", "-3.5"])
def test_a_plain_decimal_gain_is_accepted(gain: str) -> None:
    assert f'gain="{gain}"'.encode() in matrix_body(pipelines(rows({"gain": gain})))


# --- 6. control characters in the process string ------------------------------


def test_a_control_character_in_the_process_string_is_refused() -> None:
    with pytest.raises(GroundingError):
        pipelines(rows({"process": "eq\x07more"}))


def test_a_control_character_in_the_process_string_says_so() -> None:
    with pytest.raises(GroundingError, match=f"{PIPE}: control characters in process string"):
        pipelines(rows({"process": "eq\x07more"}))


# --- 7/8/9. the row list itself -----------------------------------------------

BAD_ROW_LISTS = [
    pytest.param({"source": 0, "mixdown": 0}, id="object-not-list"),
    pytest.param([], id="empty-list"),
    pytest.param([{"source": 0, "mixdown": 0}] * (ROWS_MAX + 1), id="one-row-over-the-ceiling"),
]


@pytest.mark.parametrize("value", BAD_ROW_LISTS)
def test_a_value_that_is_not_one_to_128_rows_is_refused(value: Any) -> None:
    with pytest.raises(GroundingError):
        pipelines(value)


@pytest.mark.parametrize("value", BAD_ROW_LISTS)
def test_a_value_that_is_not_one_to_128_rows_says_it_must_be_a_list_of_1_to_128(value: Any) -> None:
    with pytest.raises(GroundingError, match=re.escape(f"{PIPE}: must be a list of 1..128 rows")):
        pipelines(value)


def test_a_list_at_the_row_ceiling_is_accepted() -> None:
    written = pipelines([{"source": 0, "mixdown": 0}] * ROWS_MAX)
    assert len(re.findall(rb"<pipeline\b", matrix_body(written))) == ROWS_MAX


# --- 10. the row list is not JSON ---------------------------------------------


def test_a_pipelines_value_that_is_not_json_is_refused() -> None:
    with pytest.raises(GroundingError):
        pipelines("{not json")


def test_a_pipelines_value_that_is_not_json_says_not_valid_json() -> None:
    with pytest.raises(GroundingError, match=f"{PIPE}: not valid JSON"):
        pipelines("{not json")


# --- 11. the profile name is not a string -------------------------------------


def test_a_profile_name_that_is_not_a_string_is_refused() -> None:
    with pytest.raises(GroundingError):
        profile(save_payload(name=5))


def test_a_profile_name_that_is_not_a_string_says_it_must_be_a_string() -> None:
    with pytest.raises(GroundingError, match="name must be a string"):
        profile(save_payload(name=5))


# --- 12. the profile name is empty --------------------------------------------


@pytest.mark.parametrize("name", ["", "   "])
def test_an_empty_profile_name_is_refused(name: str) -> None:
    with pytest.raises(GroundingError):
        profile(save_payload(name=name))


@pytest.mark.parametrize("name", ["", "   "])
def test_an_empty_profile_name_says_it_must_not_be_empty(name: str) -> None:
    with pytest.raises(GroundingError, match="name must not be empty"):
        profile(save_payload(name=name))


# --- 13. the profile name is too long -----------------------------------------


def test_a_profile_name_over_the_length_ceiling_is_refused() -> None:
    with pytest.raises(GroundingError):
        profile(save_payload(name="x" * (NAME_MAX + 1)))


def test_a_profile_name_over_the_length_ceiling_says_how_long_is_allowed() -> None:
    with pytest.raises(GroundingError, match=f"name longer than {NAME_MAX} characters"):
        profile(save_payload(name="x" * (NAME_MAX + 1)))


def test_a_profile_name_exactly_at_the_length_ceiling_is_accepted() -> None:
    name = "x" * NAME_MAX
    assert f'name="{name}"'.encode() in profile(save_payload(name=name))


# --- 14. a control character in the profile name ------------------------------


def test_a_control_character_in_the_profile_name_is_refused() -> None:
    with pytest.raises(GroundingError):
        profile(save_payload(name="bad\x07name"))


def test_a_control_character_in_the_profile_name_says_so() -> None:
    with pytest.raises(GroundingError, match="control characters in name"):
        profile(save_payload(name="bad\x07name"))


# --- 15. the save payload is not JSON -----------------------------------------


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
def test_a_save_payload_that_is_not_json_is_refused(entry: Callable[[str], Any]) -> None:
    with pytest.raises(GroundingError):
        entry("{not json")


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
def test_a_save_payload_that_is_not_json_says_not_valid_json(entry: Callable[[str], Any]) -> None:
    with pytest.raises(GroundingError, match=f"{SAVE}: not valid JSON"):
        entry("{not json")


# --- 16. the save payload is not an object ------------------------------------

NON_OBJECT_PAYLOADS = [pytest.param("[1, 2]", id="array"), pytest.param("5", id="bare-number")]


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
@pytest.mark.parametrize("payload", NON_OBJECT_PAYLOADS)
def test_a_save_payload_that_is_not_an_object_is_refused(entry: Callable[[str], Any], payload: str) -> None:
    with pytest.raises(GroundingError):
        entry(payload)


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
@pytest.mark.parametrize("payload", NON_OBJECT_PAYLOADS)
def test_a_save_payload_that_is_not_an_object_says_it_needs_name_and_rows(
    entry: Callable[[str], Any], payload: str
) -> None:
    with pytest.raises(GroundingError, match=f"{SAVE}: must be an object with name and rows"):
        entry(payload)


# --- 17. presets is not a list of preset names --------------------------------

BAD_PRESETS = [pytest.param("Office", id="bare-string"), pytest.param([1], id="list-of-non-strings")]


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
@pytest.mark.parametrize("presets", BAD_PRESETS)
def test_a_presets_key_that_is_not_a_list_of_names_is_refused(entry: Callable[[str], Any], presets: Any) -> None:
    with pytest.raises(GroundingError):
        entry(json.dumps(save_payload(presets=presets)))


@pytest.mark.parametrize("entry", SAVE_ENTRIES)
@pytest.mark.parametrize("presets", BAD_PRESETS)
def test_a_presets_key_that_is_not_a_list_of_names_says_so(entry: Callable[[str], Any], presets: Any) -> None:
    with pytest.raises(GroundingError, match=f"{SAVE}: presets must be a list of preset names"):
        entry(json.dumps(save_payload(presets=presets)))


def test_save_targets_returns_the_named_fanout_targets() -> None:
    assert matrixconf.save_targets(json.dumps(save_payload(presets=["Office", "Den"]))) == ["Office", "Den"]


def test_a_save_payload_without_a_presets_key_names_no_targets() -> None:
    assert matrixconf.save_targets(json.dumps(save_payload())) == []


# --- 18. a snapshot the writer cannot ground itself in -------------------------


def test_a_snapshot_without_the_hqplayerd_root_is_refused() -> None:
    with pytest.raises(GroundingError):
        matrixconf.write_profile(b'<?xml version="1.0"?><other/>', json.dumps(save_payload()))


def test_a_snapshot_without_the_hqplayerd_root_says_the_root_element_is_absent() -> None:
    with pytest.raises(GroundingError, match="no hqplayerd root element"):
        matrixconf.write_profile(b'<?xml version="1.0"?><other/>', json.dumps(save_payload()))


def test_a_snapshot_with_no_matrix_element_still_receives_the_saved_profile() -> None:
    # a rooted snapshot that carries no live <matrix>: the save is not refused,
    # the element is created (see the report — the brief expected a refusal here)
    written = matrixconf.write_profile(rooted_without_matrix(), json.dumps(save_payload(name="Night")))
    assert b'<matrix_profile name="Night">' in written


# --- 19/20. parse_delete ------------------------------------------------------


def test_a_targeted_delete_payload_yields_its_profile_name() -> None:
    assert matrixconf.parse_delete(json.dumps({"name": "Stock", "presets": ["Office"]}))[0] == "Stock"


def test_a_targeted_delete_payload_yields_its_preset_targets() -> None:
    assert matrixconf.parse_delete(json.dumps({"name": "Stock", "presets": ["Office"]}))[1] == ["Office"]


def test_a_delete_object_without_a_name_key_is_taken_whole_as_the_profile_name() -> None:
    payload = json.dumps({"presets": ["Office"]})
    assert matrixconf.parse_delete(payload)[0] == payload


def test_a_delete_object_without_a_name_key_names_no_targets() -> None:
    assert matrixconf.parse_delete(json.dumps({"presets": ["Office"]}))[1] == []


def test_a_bare_profile_name_delete_round_trips_as_its_own_name() -> None:
    assert matrixconf.parse_delete("Stock")[0] == "Stock"


def test_a_bare_profile_name_delete_names_no_targets() -> None:
    assert matrixconf.parse_delete("Stock")[1] == []


# --- the rejection type a caller can catch ------------------------------------


def test_a_rejection_is_catchable_as_a_value_error() -> None:
    with pytest.raises(ValueError):
        pipelines([])
