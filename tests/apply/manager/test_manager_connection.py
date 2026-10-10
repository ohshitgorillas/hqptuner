"""Connection-manager alarm bookkeeping and the mode-name join: the alarm trips
only past the threshold (in virtual time), and the mode name is a join of the
engine's State onto the modes enumeration."""

import pytest
from conftest import LiveManager
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager

# --- the alarm: unreachable beyond the threshold ------------------------------


@pytest.mark.parametrize(
    ("threshold", "expected"),
    [(60.0, False), (1.0, True)],
    ids=["inside_threshold", "past_threshold"],
)
async def test_the_alarm_trips_only_once_unreachable_past_the_threshold(threshold: float, *, expected: bool) -> None:
    # a never-connected manager; the wait is paid in virtual time
    manager = ConnectionManager(Config(alarm_threshold=threshold), clock=VirtualClock())
    await manager.clock.sleep(2.0)
    assert manager.alarm is expected


# --- mode-name join -----------------------------------------------------------


async def _manager(live_manager: LiveManager, state: dict[str, str] | None) -> ConnectionManager:
    """A never-connected manager for ``None``, else one connected on that State."""
    if state is None:
        return ConnectionManager(Config())
    manager, _, _ = await live_manager(**state)
    return manager


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (None, ""),
        # a DAC that cannot do DSD enumerates no SDM entry while the engine still
        # reports mode index 2, so the join finds nothing — and naming some other
        # mode instead would report a mode the engine is not in
        ({"mode": "2", "_no_sdm": "1"}, ""),
        ({}, "PCM"),
    ],
    ids=["never_connected", "mode_index_absent_from_the_enum", "connected_in_pcm"],
)
async def test_current_mode_name_is_the_enumerated_name_of_the_engine_mode_and_empty_when_there_is_none(
    live_manager: LiveManager, state: dict[str, str] | None, expected: str
) -> None:
    assert engineread.current_mode_name(await _manager(live_manager, state)) == expected
