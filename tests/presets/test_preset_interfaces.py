"""A preset load keeps the machine's network interfaces from the running config.

A preset is a whole-config snapshot, so it carries the UPnP interface (readme §1.4) and the
NAA discovery interface (readme §1.3.5) that were set when it was saved. Results are read
with a real XML parser rather than the editor's own locators, so a writer and reader wrong the
same way cannot pass together.
"""

import io
import zipfile
from pathlib import Path
from typing import Any

import pytest
from defusedxml.ElementTree import fromstring
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.conf.presetiface import keep_interfaces
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.store.presets import PresetStore

_PRESET = (
    b'<?xml version="1.0" encoding="utf-8"?>\n<hqplayerd>\n\t<pcm filter="40"/>\n\t<engine>\n'
    b'\t\t<network address="S26" mcast_interface="br0"/>\n\t</engine>\n'
    b'\t<upnp freewheel="0" interface="br0"/>\n</hqplayerd>\n'
)
_RUNNING = (
    b'<?xml version="1.0" encoding="utf-8"?>\n<hqplayerd>\n\t<pcm filter="58"/>\n\t<engine>\n'
    b'\t\t<network address="Red" mcast_interface="enp1s0"/>\n\t</engine>\n'
    b'\t<upnp freewheel="1" interface="enp2s0"/>\n</hqplayerd>\n'
)
_RUNNING_WITHOUT_INTERFACES = (
    b'<?xml version="1.0" encoding="utf-8"?>\n<hqplayerd>\n\t<pcm filter="58"/>\n\t<engine>\n'
    b'\t\t<network address="Red"/>\n\t</engine>\n\t<upnp freewheel="1"/>\n</hqplayerd>\n'
)

#: The interface the daemon is running on, and the one the stored preset was saved with.
RUNNING_INTERFACE = "enp2s0"
SAVED_INTERFACE = "br0"


def _attrs(xml: bytes, tag: str) -> dict[str, str]:
    """Every attribute of the first ``tag`` element in ``xml``."""
    element = fromstring(xml).find(f".//{tag}")
    if element is None:
        raise FixtureError(reason=f"the fixture XML carries no <{tag}>")
    return dict(element.attrib)


@pytest.mark.parametrize(
    ("tag", "attr", "running", "expected"),
    [
        ("upnp", "interface", _RUNNING, "enp2s0"),
        ("network", "mcast_interface", _RUNNING, "enp1s0"),
        ("upnp", "interface", _RUNNING_WITHOUT_INTERFACES, None),
        ("network", "mcast_interface", _RUNNING_WITHOUT_INTERFACES, None),
    ],
)
def test_a_loaded_preset_carries_the_interface_the_running_config_sets_or_none_where_it_sets_none(
    tag: str, attr: str, running: bytes, expected: str | None
) -> None:
    assert _attrs(keep_interfaces(_PRESET, running), tag).get(attr) == expected


@pytest.mark.parametrize(
    ("tag", "attr", "preset_value"),
    [("pcm", "filter", "40"), ("network", "address", "S26"), ("upnp", "freewheel", "0")],
)
def test_other_settings_stay_as_the_preset_saved_them(tag: str, attr: str, preset_value: str) -> None:
    assert _attrs(keep_interfaces(_PRESET, _RUNNING), tag).get(attr) == preset_value


def test_without_a_running_config_the_preset_keeps_its_own_interface() -> None:
    assert _attrs(keep_interfaces(_PRESET, b""), "upnp").get("interface") == "br0"


def _uploaded_upnp_interface(archive: bytes) -> str:
    """The UPnP interface the working config in an uploaded restore archive names; empty when it names none."""
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        return _attrs(z.read("hqplayerd.xml"), "upnp").get("interface", "")


async def test_loading_a_preset_uploads_the_interface_the_daemon_runs_on(
    http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    """The preset was saved with another interface; the archive the load restores keeps the running one."""
    http_daemon["upnp_interface"] = RUNNING_INTERFACE
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    manager = ConnectionManager(
        Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets"), http, VirtualClock()
    )
    store = PresetStore(tmp_path / "presets")
    try:
        await manager.presetops.save_preset("Elsewhere")
        saved = store.read("Elsewhere")
        store.save(
            "Elsewhere",
            saved.replace(f'interface="{RUNNING_INTERFACE}"'.encode(), f'interface="{SAVED_INTERFACE}"'.encode()),
        )
        await manager.presetops.load_preset("Elsewhere")
    finally:
        await http.aclose()
    assert _uploaded_upnp_interface(http_daemon["_restore_bytes"]) == RUNNING_INTERFACE
