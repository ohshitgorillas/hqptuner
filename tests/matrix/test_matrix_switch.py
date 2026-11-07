"""Live matrix-profile switch (``matrixlane.switch_profile``) through the
public surface against the wire fakes: 4321 ``MatrixSetProfile`` plus a State
readback for the new active name, then an 8088 form resync. Each case runs the
manager on a virtual clock, so no poll pass runs while a switch is in flight and
a form refresh seen after it is the switch's own resync."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from conftest import StartManager
from narrow import FixtureError, present
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Stamp
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import matrixlane

#: A profile the fakes on both lanes list as saved.
PROFILE = "Mch-to-Stereo mixdown"
#: A stamp older than every connection, so the first connection's Ready lands after it.
BEFORE_ANY_CONNECTION = Stamp(generation=-1, at=0.0)


@pytest.fixture
async def switch_manager(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock
) -> AsyncIterator[ConnectionManager]:
    """A manager connected to both fakes, handed over once its phase stands Ready."""
    manager = await start_manager(http_daemon["_port"])
    if not await manager.phase.until_ready(after=BEFORE_ANY_CONNECTION, clock=clock):
        raise FixtureError(reason="the manager never stood Ready against the fakes")
    yield manager


async def test_switch_reports_the_new_active_profile(switch_manager: ConnectionManager) -> None:
    result = await matrixlane.switch_profile(switch_manager, PROFILE)
    assert result.active == PROFILE


async def test_switch_updates_the_state_snapshot(switch_manager: ConnectionManager) -> None:
    await matrixlane.switch_profile(switch_manager, PROFILE)
    assert present(switch_manager.readings.state)["matrix_profile"] == PROFILE


async def test_switch_resyncs_the_matrix_form(switch_manager: ConnectionManager, http_daemon: dict[str, Any]) -> None:
    http_daemon["matrix_active"] = PROFILE
    await matrixlane.switch_profile(switch_manager, PROFILE)
    assert present(switch_manager.readings.matrix_form)["active"] == PROFILE
