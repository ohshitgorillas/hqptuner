"""The config-file read lane, for settings whose XML domain is wider than the
widget hqplayerd renders for them on ``/config``.

``volume_fixed`` is the case: 0 = off, 1 = -3 dB, 2 = -6 dB in the XML (readme
§1.2), but the daemon's own form renders a bare checkbox, so the form alone
cannot tell -3 dB from -6 dB. Two things follow, and both are asserted here: the
value is readable from the config file, and -6 dB is writable at all -- which
holds only because the persistent lane is a snapshot-XML restore rather than a
form POST. If that lane ever goes back to posting the form, these fail.
"""

from hqptuner.conf import presetconf
from hqptuner.manager import ConnectionManager


def test_fixed_volume_headroom_level_is_read_from_the_engine_element() -> None:
    xml = b'<hqplayerd><engine volume_fixed="2"/></hqplayerd>'
    assert presetconf.read_config(xml)["volume_fixed"] == "2"


def test_minus_6_db_headroom_is_written_into_the_snapshot() -> None:
    xml = b'<hqplayerd><engine volume_fixed="1"/></hqplayerd>'
    edited = presetconf.apply_edits(xml, {"volume_fixed": "2"})
    assert presetconf.read_config(edited)["volume_fixed"] == "2"


def test_backslash_in_a_written_value_survives_verbatim() -> None:
    # a value is data, not a regex replacement template: an unescaped backslash
    # used to be read as a group reference and corrupt (or fail) the write
    xml = b'<hqplayerd><log file="/var/log/hqplayerd.log"/></hqplayerd>'
    edited = presetconf.apply_edits(xml, {"log_file": r"C:\logs\hqplayerd.log"})
    assert presetconf.read_config(edited)["log_file"] == r"C:\logs\hqplayerd.log"


async def test_minus_6_db_headroom_survives_an_apply(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"volume_fixed": "2"})
    assert (await http_manager.load_file_config())["volume_fixed"] == "2"


async def test_headroom_apply_preserves_unrelated_settings(http_manager: ConnectionManager) -> None:
    await http_manager.apply({}, {"volume_fixed": "2"})
    assert (await http_manager.load_file_config())["channels"] == "2"
