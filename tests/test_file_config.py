"""The config-file read lane, for settings whose XML domain is wider than the
widget hqplayerd renders for them on ``/config``.

``volume_fixed`` is the case: 0 = off, 1 = -3 dB, 2 = -6 dB in the XML (readme
§1.2), but the daemon's own form renders a bare checkbox, so the form alone
cannot tell -3 dB from -6 dB. Two things follow, and both are asserted here: the
value is readable from the config file, and -6 dB is writable at all -- which
holds only because the persistent lane is a snapshot-XML restore rather than a
form POST. If that lane ever goes back to posting the form, these fail.
"""

from pathlib import Path
from typing import Any

import pytest

from hqptuner import presetconf
from hqptuner.config import Config
from hqptuner.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


@pytest.fixture
async def file_manager(http_daemon: dict[str, Any], tmp_path: Path) -> Any:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    mgr = ConnectionManager(Config(hqp_host="127.0.0.1", backup_dir=tmp_path), http_client=http)
    yield mgr
    await http.aclose()


def test_fixed_volume_headroom_level_is_read_from_the_engine_element() -> None:
    xml = b'<hqplayerd><engine volume_fixed="2"/></hqplayerd>'
    assert presetconf.read_config(xml)["volume_fixed"] == "2"


def test_minus_6_db_headroom_is_written_into_the_snapshot() -> None:
    xml = b'<hqplayerd><engine volume_fixed="1"/></hqplayerd>'
    edited = presetconf.apply_edits(xml, {"volume_fixed": "2"})
    assert presetconf.read_config(edited)["volume_fixed"] == "2"


async def test_minus_6_db_headroom_survives_an_apply(file_manager: ConnectionManager) -> None:
    await file_manager.apply({}, {"volume_fixed": "2"})
    assert (await file_manager.load_file_config())["volume_fixed"] == "2"


async def test_headroom_apply_preserves_unrelated_settings(file_manager: ConnectionManager) -> None:
    await file_manager.apply({}, {"volume_fixed": "2"})
    assert (await file_manager.load_file_config())["channels"] == "2"
