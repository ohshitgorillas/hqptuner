"""Every value HQPTuner writes into hqplayerd.xml is escaped, and read back unescaped.

The expected bytes are written out by hand: escaping through the helper under test
would pass for any table, right or wrong.
"""

from hqptuner.conf import presetconf

_TITLE = b'<hqplayerd><title value="old"/></hqplayerd>'
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
