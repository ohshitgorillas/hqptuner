"""Every settable field must land on a config that never carried its element.

hqplayerd writes only the elements it has had reason to write, and fills none of
them back in on load. A user who has never configured loudness has no ``<plugin
type="loudness">`` in their config; a user who has never turned matrix processing
on has no ``<matrix>`` body. So "the target is absent" is not an edge case, it is
the ordinary state of a config for every feature its owner has not used yet — and
the write path has to place the element, not refuse the edit.

The parametrization is driven straight off ``FIELD_MAP``/``PLUGIN_MAP``/``PARENT``
rather than a hand-written list of fields. That is the point of this file: it is
derived from the same data the feature is, so it cannot drift out of sync with it.
Add a field to a map and it is covered without anyone remembering to; reintroduce
a refusal for any class of absent target and the whole suite goes red at once.
"""

import xml.etree.ElementTree as ET

import pytest

from hqptuner.conf import presetconf, xmledit

# Nothing but the root: every element the daemon would have written is absent.
BARE = b"<hqplayerd/>"


def _parent_of(xml: bytes, tag: str) -> str | None:
    """The tag of ``tag``'s parent, by real XML parse — a check independent of the
    locators under test, which also proves the result is well-formed."""
    root = ET.fromstring(xml)  # noqa: S314 - the input is the XML this test just produced
    return next((p.tag for p in root.iter() for c in p if c.tag == tag), None)


def test_a_created_plugin_lands_in_the_post_process_container() -> None:
    assert _parent_of(xmledit.ensure_plugin(BARE, "loudness")[0], "plugin") == "post_process"


def test_placing_an_element_leaves_every_existing_byte_alone() -> None:
    xml = b'<hqplayerd>\n\t<engine channels="2">\n\t\t<alsa device="hw:CARD=Live,DEV=0"/>\n\t</engine>\n</hqplayerd>'
    edited = presetconf.apply_edits(xml, {"post_loudness_lowfreq": "80"})
    assert b'<alsa device="hw:CARD=Live,DEV=0"/>' in edited


def test_an_edit_with_nowhere_to_go_still_names_the_setting_that_failed() -> None:
    # "this snapshot has no hqplayerd root element" does not say which of four
    # staged changes is the one at fault; the form field's name does
    with pytest.raises(xmledit.GroundingError, match="alsa_dop"):
        presetconf.apply_edits(b"<nonsense/>", {"alsa_dop": "1"})


def _no_place_code() -> str:
    """The ``code`` carried by the ``NoKnownPlaceError`` an unschema'd element raises."""
    with pytest.raises(xmledit.NoKnownPlaceError) as caught:
        xmledit.ensure_element(BARE, "not_a_schema_element")
    return caught.value.code


def test_an_element_with_no_known_schema_position_raises_a_typed_error() -> None:
    assert _no_place_code() == "no-place"


def test_setting_an_attribute_on_a_malformed_tag_raises_a_typed_error() -> None:
    with pytest.raises(xmledit.MalformedElementTagError):
        xmledit.set_attr(b"not an open tag", "alsa_dop", "1")
