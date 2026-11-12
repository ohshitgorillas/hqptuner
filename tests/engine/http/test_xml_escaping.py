"""Every value HQPTuner writes into hqplayerd.xml is escaped, and read back unescaped.

The expected bytes are written out by hand: escaping through the helper under test
would pass for any table, right or wrong.
"""

from io import BytesIO
from xml.parsers import expat

from hqptuner.conf import fixedvol, presetconf

_TITLE = b'<hqplayerd><title value="old"/></hqplayerd>'
_ROOT = b"<hqplayerd></hqplayerd>"
_NETWORK = b'<hqplayerd><network address="a" device="b"/></hqplayerd>'


def test_a_title_with_markup_characters_is_written_as_entities() -> None:
    edited = presetconf.apply_edits(_TITLE, {"title": "a\"b<c>d&e'f"})
    assert b'<title value="a&quot;b&lt;c&gt;d&amp;e&apos;f"/>' in edited


def test_a_title_that_closes_the_attribute_adds_no_element() -> None:
    edited = presetconf.apply_edits(_TITLE, {"title": 'x"/><foo bar="baz'})
    assert b"<foo" not in edited


def test_a_network_device_quote_is_written_as_an_entity() -> None:
    edited = presetconf.apply_edits(_NETWORK, {"net_device": 'S26/hw:"x'})
    assert b'device="hw:&quot;x"' in edited


def test_a_title_inserted_on_a_bare_element_is_escaped_too() -> None:
    edited = presetconf.apply_edits(b"<hqplayerd><title/></hqplayerd>", {"title": 'a"b'})
    assert b'<title value="a&quot;b"/>' in edited


def test_a_title_carrying_entities_is_read_as_the_characters() -> None:
    xml = b'<hqplayerd><title value="R&amp;B &apos;76&quot;"/></hqplayerd>'
    assert presetconf.read_config(xml)["title"] == "R&B '76\""


def test_a_fixed_level_that_closes_the_attribute_adds_no_element() -> None:
    edited = fixedvol.reconcile_fixed(_ROOT, {"fixed_volume_enabled": "1", "fixed_volume": '-3"/><x a="'})
    assert b"<x" not in edited


def test_a_parked_fixed_level_holding_a_double_hyphen_is_well_formed_xml() -> None:
    edited = fixedvol.reconcile_fixed(_ROOT, {"fixed_volume_enabled": "0", "fixed_volume": "1--2"})
    assert expat.ParserCreate().ParseFile(BytesIO(edited)) == 1


def test_a_parked_fixed_level_holding_a_comment_end_reads_back_as_typed() -> None:
    edited = fixedvol.reconcile_fixed(_ROOT, {"fixed_volume_enabled": "0", "fixed_volume": "1-->"})
    assert fixedvol.any_fixed_level(edited) == "1-->"


def test_a_parked_fixed_level_typed_as_a_character_reference_reads_back_as_typed() -> None:
    edited = fixedvol.reconcile_fixed(_ROOT, {"fixed_volume_enabled": "0", "fixed_volume": "--&#45;"})
    assert fixedvol.any_fixed_level(edited) == "--&#45;"


def test_a_parked_fixed_level_without_a_double_hyphen_keeps_the_daemons_bytes() -> None:
    edited = fixedvol.reconcile_fixed(_ROOT, {"fixed_volume_enabled": "0", "fixed_volume": "-3"})
    assert b'<!--<fixed volume="-3"/>-->' in edited
