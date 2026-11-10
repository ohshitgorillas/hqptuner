"""The ungated /about and /log readers reach the daemon through the network their manager is handed.

Policy: docs/testing.md. The 8088 fake is served only in process, at an address no socket answers on.
"""

from typing import Any

import pytest
from conftest import StartManager

from hqptuner.core import engineread
from hqptuner.engine.devicecaps import DeviceCaps

SELECTED = "S26/hw:CARD=Output,DEV=0"
ANNOUNCED = (
    "2026/08/01 02:03:37 NAA output endpoint 'S26' : 'hw:CARD=Output,DEV=0'\n"
    "2026/08/01 02:03:38 NAA output network format: 44100/32/2 [pcm]\n"
    "2026/08/01 02:03:38 NAA output network format: 192000/32/2 [pcm]\n"
)


def _pcm_rates(caps: DeviceCaps | None) -> list[int] | None:
    """The PCM rates a capability holds, or None where no capability is known."""
    return None if caps is None else caps.pcm_rates


@pytest.mark.parametrize("release", ["6.0.4", "7.2.1"])
async def test_a_manager_connecting_holds_the_release_the_in_process_about_page_prints(
    start_manager: StartManager, http_daemon: dict[str, Any], release: str
) -> None:
    http_daemon["release"] = release
    manager = await start_manager(http_daemon["_port"])
    assert manager.readings.release == release


async def test_the_log_tail_is_the_last_lines_of_the_in_process_log(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_log"] = "\n".join(f"entry {i}" for i in range(1, 8))
    manager = await start_manager(http_daemon["_port"])
    tail = await engineread.read_log_tail(manager, 3)
    assert tail.lines == ["entry 5", "entry 6", "entry 7"]


async def test_the_selected_devices_capability_is_read_from_the_in_process_log(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_log"] = ANNOUNCED
    manager = await start_manager(http_daemon["_port"])
    manager.readings.config_form = {
        "fields": [{"name": "backend", "value": "network"}, {"name": "net_device", "value": SELECTED}],
        "profiles": None,
    }
    await engineread.refresh_device_caps(manager, force=True)
    assert _pcm_rates(manager.readings.device_caps) == [44100, 192000]
