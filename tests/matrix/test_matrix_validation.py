"""Input validation on the matrix config-form fields.

Characterization of behavior that already exists: ``matrix_pipelines`` and
``matrix_profile_save`` arrive as JSON strings off a config form, and every
malformed shape is refused with a ``GroundingError`` before any XML is written.
The snapshots come from the fake daemon's own config renderer, so the validators
are exercised against 6.0.4-shaped documents, and the accepted side is read back
by an independent regex over the ``<matrix>`` body rather than through the
writer under test.

Each refusal is identified by the ``code`` its ``GroundingError`` carries, and
is caught as a ``GroundingError``, so a refusal raised as anything else still
fails the case.

The field-name prefix is read off the module's public constant. The profile
name-length ceiling is *not* exported as a constant, so ``NAME_MAX`` below
restates the contract value; if that ceiling ever moves, this constant moves
with it.
"""

import json
import re
from collections.abc import Callable
from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import matrixconf, matrixpayload, matrixprofiles
from hqptuner.conf.xmledit import GroundingError

#: The profile-name ceiling. See the module docstring: no public constant.
NAME_MAX = 128

#: The pipeline-row ceiling.
ROWS_MAX = 128

#: The first channel past the 0..127 range a row's source and mixdown live in.
CHANNEL_PAST_RANGE = 128

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


def pipelines(value: object) -> bytes:
    """Stage a ``matrix_pipelines`` value; a str goes through verbatim so a
    malformed-JSON case can be expressed."""
    return matrixconf.replace_pipelines(cfg(), value if isinstance(value, str) else json.dumps(value))


def rows(*extra: dict[str, Any]) -> list[dict[str, Any]]:
    """A row list of one row, the given overrides applied."""
    return [{**ROW, **e} for e in extra] or [ROW]


def profile(payload: object) -> bytes:
    """Stage a ``matrix_profile_save`` value against a valid snapshot."""
    return matrixprofiles.write_profile(cfg(), payload if isinstance(payload, str) else json.dumps(payload))


def save_payload(**overrides: object) -> dict[str, Any]:
    return {"name": "Crossfeed EQ", "rows": [ROW], **overrides}


# --- 3. source/mixdown out of the 0..127 channel range ------------------------


def test_the_top_channel_of_the_range_is_accepted() -> None:
    assert b'source="127"' in matrix_body(pipelines(rows({"source": 127, "mixdown": 127})))


# --- 4. gainunit --------------------------------------------------------------


def test_a_linear_gain_is_written_with_its_own_marker() -> None:
    assert b'gain="L2"' in matrix_body(pipelines(rows({"gainunit": "Lin", "gain": "2"})))


# --- 5. gain ------------------------------------------------------------------


@pytest.mark.parametrize("gain", ["-3.5"])
def test_a_plain_decimal_gain_is_accepted(gain: str) -> None:
    assert f'gain="{gain}"'.encode() in matrix_body(pipelines(rows({"gain": gain})))


# --- 7/8/9. the row list itself -----------------------------------------------


def test_a_list_at_the_row_ceiling_is_accepted() -> None:
    written = pipelines([{"source": 0, "mixdown": 0}] * ROWS_MAX)
    assert len(re.findall(rb"<pipeline\b", matrix_body(written))) == ROWS_MAX


# --- 13. the profile name is too long -----------------------------------------


def test_a_profile_name_exactly_at_the_length_ceiling_is_accepted() -> None:
    name = "x" * NAME_MAX
    assert f'name="{name}"'.encode() in profile(save_payload(name=name))


# --- 17. presets is not a list of preset names --------------------------------

SAVE_TARGETS = [
    pytest.param({}, [], id="no-presets-key"),
    pytest.param({"presets": ["Office", "Den"]}, ["Office", "Den"], id="presets-key"),
]


@pytest.mark.parametrize(("overrides", "expected"), SAVE_TARGETS)
def test_a_save_payload_names_the_targets_its_presets_key_lists(
    overrides: dict[str, object], expected: list[str]
) -> None:
    assert matrixprofiles.save_targets(json.dumps(save_payload(**overrides))) == expected


# --- 18. a snapshot the writer cannot ground itself in -------------------------


def test_a_snapshot_with_no_matrix_element_still_receives_the_saved_profile() -> None:
    # a rooted snapshot that carries no live <matrix>: the save is not refused,
    # the element is created (see the report — the brief expected a refusal here)
    written = matrixprofiles.write_profile(rooted_without_matrix(), json.dumps(save_payload(name="Night")))
    assert b'<matrix_profile name="Night">' in written


# --- 19/20. parse_delete ------------------------------------------------------


def test_a_targeted_delete_payload_yields_its_profile_name() -> None:
    assert matrixpayload.parse_delete(json.dumps({"name": "Stock", "presets": ["Office"]}))[0] == "Stock"


DELETE_TARGETS = [
    pytest.param({"name": "Stock"}, [], id="no-presets-key"),
    pytest.param({"name": "Stock", "presets": ["Office"]}, ["Office"], id="presets-key"),
]


@pytest.mark.parametrize(("value", "expected"), DELETE_TARGETS)
def test_a_delete_payload_names_the_targets_its_presets_key_lists(
    value: dict[str, object], expected: list[str]
) -> None:
    assert matrixpayload.parse_delete(json.dumps(value))[1] == expected


# --- a malformed save or delete payload names its malformation -----------------

SAVE = matrixpayload.parse_save
DELETE = matrixpayload.parse_delete
NOT_JSON = "{name: Night"

REFUSALS = [
    pytest.param(SAVE, NOT_JSON, "save-bad-json", id="save-not-json"),
    pytest.param(SAVE, json.dumps([save_payload()]), "save-bad-shape", id="save-not-an-object"),
    pytest.param(DELETE, NOT_JSON, "delete-bad-json", id="delete-not-json"),
    pytest.param(DELETE, json.dumps("Stock"), "delete-bad-shape", id="delete-not-an-object"),
    pytest.param(SAVE, json.dumps(save_payload(name=7)), "name-not-string", id="save-name-a-number"),
    pytest.param(DELETE, json.dumps({"presets": ["Office"]}), "name-not-string", id="delete-without-name"),
    pytest.param(SAVE, json.dumps(save_payload(name="   ")), "name-empty", id="name-blank"),
    pytest.param(SAVE, json.dumps(save_payload(name="x" * (NAME_MAX + 1))), "name-too-long", id="name-over-ceiling"),
    pytest.param(SAVE, json.dumps(save_payload(name="Night\nShift")), "name-control-chars", id="name-newline"),
    pytest.param(SAVE, json.dumps(save_payload(rows=[ROW] * (ROWS_MAX + 1))), "rows-bad-list", id="rows-over-ceiling"),
    pytest.param(SAVE, json.dumps(save_payload(rows=["0"])), "row-not-object", id="row-a-string"),
    pytest.param(
        SAVE, json.dumps(save_payload(rows=rows({"source": "left"}))), "row-channel-not-int", id="source-a-word"
    ),
    pytest.param(
        SAVE,
        json.dumps(save_payload(rows=rows({"mixdown": CHANNEL_PAST_RANGE}))),
        "row-channel-range",
        id="mixdown-128",
    ),
    pytest.param(SAVE, json.dumps(save_payload(rows=rows({"gain": "3dB"}))), "row-bad-gain", id="gain-with-unit"),
    pytest.param(SAVE, json.dumps(save_payload(rows=rows({"gainunit": "dBFS"}))), "row-bad-gainunit", id="unit-dbfs"),
    pytest.param(
        SAVE, json.dumps(save_payload(rows=rows({"process": "a\x00b"}))), "row-control-chars", id="process-nul"
    ),
    pytest.param(SAVE, json.dumps(save_payload(presets="Office")), "targets-bad-list", id="save-presets-a-string"),
    pytest.param(
        DELETE, json.dumps({"name": "Stock", "presets": ["Office", 3]}), "targets-bad-list", id="delete-preset-3"
    ),
]


@pytest.mark.parametrize(("parse", "value", "code"), REFUSALS)
def test_a_malformed_profile_payload_is_refused_with_the_code_of_its_malformation(
    parse: Callable[[str], object], value: str, code: str
) -> None:
    with pytest.raises(GroundingError) as refused:
        parse(value)
    assert refused.value.code == code


# --- the rejection type a caller can catch ------------------------------------


def test_a_rejection_is_catchable_as_a_value_error() -> None:
    with pytest.raises(ValueError):
        pipelines([])
