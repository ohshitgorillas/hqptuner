"""What a user is told when HQPTuner holds no control connection to HQPlayer and a write or a heartbeat needs one.

The sentence is owner copy (docs/testing.md rule 9), so none is asserted. What is asserted is
what the fixture knows: the host and port the manager is configured with, and the error code.
"""

import pytest
from apps import closed_port, settled
from conftest import LiveManager
from virtual_clock import VirtualClock

from hqptuner.core import loader
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError


async def _manager_without_control(live_manager: LiveManager, clock: VirtualClock) -> ConnectionManager:
    """A ready two-lane manager whose 4321 address is retargeted at a port nothing answers on, so its control
    connection is gone and every reconnect is refused."""
    manager, _log, _state = await live_manager()
    manager.cfg.hqp_control_port = closed_port()
    await manager.retarget()
    await settled(clock)
    return manager


def _looked_for_at(manager: ConnectionManager) -> str:
    return f"{manager.cfg.hqp_host}:{manager.cfg.hqp_control_port}"


async def test_a_write_with_no_connection_names_the_address_hqplayer_was_looked_for_at(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    manager = await _manager_without_control(live_manager, clock)
    with pytest.raises(ControlError) as caught:
        manager.require_control()
    assert _looked_for_at(manager) in str(caught.value)


async def test_a_heartbeat_with_no_connection_names_the_address_hqplayer_was_looked_for_at(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    manager = await _manager_without_control(live_manager, clock)
    with pytest.raises(ControlError) as caught:
        await loader.poll(manager)
    assert _looked_for_at(manager) in str(caught.value)


async def test_a_write_with_no_connection_keeps_its_code(live_manager: LiveManager, clock: VirtualClock) -> None:
    manager = await _manager_without_control(live_manager, clock)
    with pytest.raises(ControlError) as caught:
        manager.require_control()
    assert caught.value.code == "daemon_unavailable"


async def test_a_heartbeat_with_no_connection_keeps_its_code(live_manager: LiveManager, clock: VirtualClock) -> None:
    manager = await _manager_without_control(live_manager, clock)
    with pytest.raises(ControlError) as caught:
        await loader.poll(manager)
    assert caught.value.code == "daemon_unavailable"
