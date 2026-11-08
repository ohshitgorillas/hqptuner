"""The ungated /about and /log readers reach the daemon through the network their manager is handed.

Policy: docs/testing.md. The 8088 fake is served only in process, at an address no socket answers on.
"""

import functools
from collections.abc import Iterator
from typing import Any

import fake_http
import fake_network
import pytest
from apps import settled
from fake_control import DEFAULTS, serve_shared
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.devicecaps import DeviceCaps

SELECTED = "S26/hw:CARD=Output,DEV=0"
ANNOUNCED = (
    "2026/08/01 02:03:37 NAA output endpoint 'S26' : 'hw:CARD=Output,DEV=0'\n"
    "2026/08/01 02:03:38 NAA output network format: 44100/32/2 [pcm]\n"
    "2026/08/01 02:03:38 NAA output network format: 192000/32/2 [pcm]\n"
)


@pytest.fixture
def daemon() -> Iterator[dict[str, Any]]:
    """An 8088 fake served only in process; the test sets what it prints."""
    served = fake_http.spawn(fake_http.state(), in_process=True)
    yield next(served)
    next(served, None)


def _manager(http: dict[str, Any], clock: VirtualClock | None = None, control_port: int = 0) -> ConnectionManager:
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=control_port, hqp_http_port=http["_port"])
    return ConnectionManager(cfg, clock=clock, network=fake_network.NETWORK)


def _pcm_rates(caps: DeviceCaps | None) -> list[int] | None:
    """The PCM rates a capability holds, or None where no capability is known."""
    return None if caps is None else caps.pcm_rates


@pytest.mark.parametrize("release", ["6.0.4", "7.2.1"])
async def test_a_manager_connecting_holds_the_release_the_in_process_about_page_prints(
    daemon: dict[str, Any], release: str
) -> None:
    daemon["release"] = release
    clock = VirtualClock()
    with fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS))) as control_port:
        manager = _manager(daemon, clock, control_port)
        task = clock.spawn(manager.run())
        await settled(clock)
        held = manager.readings.release
        manager.stop()
        await task
        await manager.aclose()
    assert held == release


async def test_the_log_tail_is_the_last_lines_of_the_in_process_log(daemon: dict[str, Any]) -> None:
    daemon["_log"] = "\n".join(f"entry {i}" for i in range(1, 8))
    tail = await engineread.read_log_tail(_manager(daemon), 3)
    assert tail.lines == ["entry 5", "entry 6", "entry 7"]


async def test_the_selected_devices_capability_is_read_from_the_in_process_log(daemon: dict[str, Any]) -> None:
    daemon["_log"] = ANNOUNCED
    manager = _manager(daemon)
    manager.readings.config_form = {
        "fields": [{"name": "backend", "value": "network"}, {"name": "net_device", "value": SELECTED}],
        "profiles": None,
    }
    await engineread.refresh_device_caps(manager, force=True)
    assert _pcm_rates(manager.readings.device_caps) == [44100, 192000]
