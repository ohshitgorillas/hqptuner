"""The register answers a field's live facts directly, with no optional to narrow.

Every expected value is a row of the spec's "Fields with a setter" table. A field
outside that table has no live facts, and asking for them raises ``KeyError``.
"""

import pytest

from hqptuner.fields import query

#: "Fields with a setter", column "Setter, argument": the command that writes each field.
SETTER_COMMANDS = {
    "mode": "SetMode",
    "filter1x": "SetFilter",
    "filter": "SetFilter",
    "dither": "SetShaping",
    "oversampling1x": "SetFilter",
    "oversampling": "SetFilter",
    "modulator": "SetShaping",
    "adaptive_volume": "SetAdaptiveVolume",
    "junk_filter": "SetJunkFilter",
    "rate": "SetRate",
    "volume": "Volume",
    "matrix_profile": "MatrixSetProfile",
}

#: "Fields with a setter", column "State attribute": the attribute that reports each field.
STATE_ATTRIBUTES = {
    "mode": "mode",
    "filter1x": "filter1x",
    "filter": "filterNx",
    "dither": "shaper",
    "oversampling1x": "filter1x",
    "oversampling": "filterNx",
    "modulator": "shaper",
    "adaptive_volume": "adaptive",
    "junk_filter": "filter_junk",
    "rate": "rate",
    "volume": "volume",
    "matrix_profile": "matrix_profile",
}

#: Fields the register holds that are not in "Fields with a setter", one from each other table,
#: several named close to a field that has a setter.
NO_SETTER = (
    "title",
    "samplerate",
    "defaults_samplerate",
    "defaults_volume",
    "volume_fixed",
    "post_bauer_level",
    "fixed_volume",
    "matrix_profiles",
    "matrix_profile_save",
    "cuda",
)

#: A name no table of the register carries.
UNKNOWN_FIELD = "no_such_field"


@pytest.mark.parametrize(("name", "command"), SETTER_COMMANDS.items())
def test_the_live_facts_of_a_field_with_a_setter_name_its_command(name: str, command: str) -> None:
    assert query.live(name).setter == command


@pytest.mark.parametrize(("name", "attribute"), STATE_ATTRIBUTES.items())
def test_the_live_facts_of_a_field_with_a_setter_name_the_state_attribute_reporting_it(
    name: str, attribute: str
) -> None:
    assert query.live(name).state == attribute


@pytest.mark.parametrize("name", NO_SETTER)
def test_asking_the_live_facts_of_a_field_without_a_setter_raises_key_error(name: str) -> None:
    with pytest.raises(KeyError):
        query.live(name)


def test_asking_the_live_facts_of_a_name_the_register_does_not_hold_raises_key_error() -> None:
    with pytest.raises(KeyError):
        query.live(UNKNOWN_FIELD)
