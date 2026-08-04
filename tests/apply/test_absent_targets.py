"""Every settable field must land on a config that never carried its element.

hqplayerd writes only the elements it has had reason to write, and fills none of
them back in on load. A user who has never configured loudness has no ``<plugin
type="loudness">`` in their config; a user who has never turned matrix processing
on has no ``<matrix>`` body. So "the target is absent" is not an edge case, it is
the ordinary state of a config for every feature its owner has not used yet — and
the write path has to place the element, not refuse the edit.

The parametrisation is driven straight off ``FIELD_MAP``/``PLUGIN_MAP``/``PARENT``
rather than a hand-written list of fields. That is the point of this file: it is
derived from the same data the feature is, so it cannot drift out of sync with it.
Add a field to a map and it is covered without anyone remembering to; reintroduce
a refusal for any class of absent target and the whole suite goes red at once.
"""

import json
import xml.etree.ElementTree as ET

import pytest

from hqptuner.conf import matrixconf, presetconf, xmledit

# Nothing but the root: every element the daemon would have written is absent.
BARE = b"<hqplayerd/>"
VALUE = "7"


def _parent_of(xml: bytes, tag: str) -> str | None:
    """The tag of ``tag``'s parent, by real XML parse — a check independent of the
    locators under test, which also proves the result is well-formed."""
    root = ET.fromstring(xml)  # noqa: S314 - the input is the XML this test just produced
    return next((p.tag for p in root.iter() for c in p if c.tag == tag), None)


@pytest.mark.parametrize("field", sorted(presetconf.FIELD_MAP) + sorted(presetconf.PLUGIN_MAP))
def test_a_setting_lands_on_a_config_that_never_carried_its_element(field: str) -> None:
    assert presetconf.read_config(presetconf.apply_edits(BARE, {field: VALUE}))[field] == VALUE


@pytest.mark.parametrize(("tag", "parent"), sorted(xmledit.PARENT.items()))
def test_a_created_element_lands_under_its_documented_parent(tag: str, parent: str) -> None:
    assert _parent_of(xmledit.ensure_element(BARE, tag), tag) == parent


def test_a_created_plugin_lands_in_the_post_process_container() -> None:
    assert _parent_of(xmledit.ensure_plugin(BARE, "loudness"), "plugin") == "post_process"


def test_a_created_element_carries_only_the_attribute_that_was_set() -> None:
    # every attribute the daemon omits is one it is already defaulting; authoring a
    # "complete" element would overwrite the user's daemon-side settings with ours
    assert b'<alsa pack_sdm="7"/>' in presetconf.apply_edits(BARE, {"alsa_dop": VALUE})


def test_the_fused_network_device_lands_on_a_config_without_a_network_element() -> None:
    edited = presetconf.apply_edits(BARE, {presetconf.NET_DEVICE: "S26/hw:CARD=Out,DEV=0"})
    assert presetconf.read_config(edited)[presetconf.NET_DEVICE] == "S26/hw:CARD=Out,DEV=0"


def test_pipeline_rows_land_on_a_config_with_no_matrix_body() -> None:
    rows = '[{"gain":"0","gainunit":"dB","mixdown":"0","process":"","source":"0"}]'
    edited = presetconf.apply_edits(BARE, {matrixconf.MATRIX_PIPELINES: rows})
    assert presetconf.read_config(edited)[matrixconf.MATRIX_PIPELINES] == rows


def test_a_profile_saves_against_a_config_with_no_matrix_element() -> None:
    save = '{"name":"Night","rows":[{"gain":"0","gainunit":"dB","mixdown":"0","process":"","source":"0"}]}'
    edited = presetconf.apply_edits(BARE, {"matrix_profile_save": save})
    assert "Night" in json.loads(presetconf.read_config(edited)["matrix_profiles"])


def test_placing_an_element_leaves_every_existing_byte_alone() -> None:
    xml = b'<hqplayerd>\n\t<engine channels="2">\n\t\t<alsa device="hw:CARD=Live,DEV=0"/>\n\t</engine>\n</hqplayerd>'
    edited = presetconf.apply_edits(xml, {"post_loudness_lowfreq": "80"})
    assert b'<alsa device="hw:CARD=Live,DEV=0"/>' in edited


def test_an_edit_with_nowhere_to_go_still_names_the_setting_that_failed() -> None:
    # "this snapshot has no hqplayerd root element" does not say which of four
    # staged changes is the one at fault; the form field's name does
    with pytest.raises(xmledit.GroundingError, match="alsa_dop"):
        presetconf.apply_edits(b"<nonsense/>", {"alsa_dop": "1"})


def test_an_unplaceable_edit_carries_no_angle_brackets() -> None:
    # the message is rendered in the pending bar; a browser eats "<alsa>" whole
    with pytest.raises(xmledit.GroundingError, match=r"^[^<>]*$"):
        presetconf.apply_edits(b"<nonsense/>", {"alsa_dop": "1"})
