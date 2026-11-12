"""The bytes a delete, a replace or a toggle removes include the newline and indentation in front of the element.

Expected bytes are written out by hand. Each case pins that the leading whitespace goes with the element, so a
rewrite that finds the element by a different route still leaves no blank line behind.
"""

import json

from hqptuner.conf import fixedvol, matrixconf, matrixprofiles, xmledit

_ROW = {"source": "0", "gain": "-3", "gainunit": "dB", "mixdown": "0", "process": ""}
_TAG = b'<pipeline channel="0" gain="-3" mixdown="0" process="" source="0"/>'
_OLD = b'<pipeline channel="0" gain="0" mixdown="0" process="" source="0"/>'


def test_deleting_an_indented_profile_leaves_no_blank_line() -> None:
    xml = b'<hqplayerd>\n\t<matrix_profile name="A"/>\n\t<matrix_profile name="B"/>\n</hqplayerd>'
    assert matrixprofiles.delete_profile(xml, "A") == b'<hqplayerd>\n\t<matrix_profile name="B"/>\n</hqplayerd>'


def test_deleting_a_profile_from_a_single_line_snapshot_removes_only_that_element() -> None:
    xml = b'<hqplayerd><matrix_profile name="A"/><matrix_profile name="B"/></hqplayerd>'
    assert matrixprofiles.delete_profile(xml, "A") == b'<hqplayerd><matrix_profile name="B"/></hqplayerd>'


def test_replacing_the_rows_of_an_indented_matrix_leaves_no_blank_line() -> None:
    xml = b"<hqplayerd>\n\t<matrix>\n\t\t" + _OLD + b"\n\t</matrix>\n</hqplayerd>"
    expected = b"<hqplayerd>\n\t<matrix>\n\t\t" + _TAG + b"\n\t</matrix>\n</hqplayerd>"
    assert matrixconf.replace_pipelines(xml, json.dumps([_ROW])) == expected


def test_replacing_the_rows_of_a_single_line_matrix_removes_only_the_old_row() -> None:
    xml = b"<hqplayerd><matrix>" + _OLD + b"</matrix></hqplayerd>"
    expected = b"<hqplayerd><matrix>\n\t\t\t" + _TAG + b"</matrix></hqplayerd>"
    assert matrixconf.replace_pipelines(xml, json.dumps([_ROW])) == expected


def test_adopting_a_chainless_profile_removes_an_indented_chain_without_a_blank_line() -> None:
    xml = (
        b"<hqplayerd>\n\t<matrix>\n\t\t<post_process>\n\t\t\t<plugin/>\n\t\t</post_process>\n\t</matrix>\n"
        b'\t<matrix_profile name="Night">\n\t</matrix_profile>\n</hqplayerd>'
    )
    expected = (
        b'<hqplayerd>\n\t<matrix>\n\t</matrix>\n\t<matrix_profile name="Night">\n\t</matrix_profile>\n</hqplayerd>'
    )
    assert matrixconf.materialize_profile(xml, "Night") == expected


def test_toggling_the_fixed_volume_off_then_on_restores_the_original_bytes() -> None:
    xml = b'<hqplayerd>\n\t<fixed volume="-3"/>\n</hqplayerd>'
    off = fixedvol.reconcile_fixed(xml, {"fixed_volume_enabled": "0"})
    assert fixedvol.reconcile_fixed(off, {"fixed_volume_enabled": "1"}) == xml


def test_dropping_an_attribute_takes_the_whitespace_before_it() -> None:
    assert xmledit.drop_attr(b'<fixed\n\tvolume="-3" x="1"/>', "volume") == b'<fixed x="1"/>'
