"""Connection-manager alarm bookkeeping and the mode-name join
(docs/testing.md): the alarm trips only past the threshold (in virtual time),
and the mode name is a join of the engine's State onto the modes enumeration."""

from typing import Any

import pytest
from apps import advanced, closed_port
from conftest import LiveManager, StartManager
from virtual_clock import VirtualClock

from hqptuner.core import engineread

# --- the alarm: unreachable beyond the threshold ------------------------------


@pytest.mark.parametrize(
    ("threshold", "expected"),
    [(60.0, False), (1.0, True)],
    ids=["inside_threshold", "past_threshold"],
)
async def test_the_alarm_trips_only_once_unreachable_past_the_threshold(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock, *, threshold: float, expected: bool
) -> None:
    # a ready manager whose 4321 address goes away; the wait is paid in virtual time
    manager = await start_manager(http_daemon["_port"], alarm_threshold=threshold)
    manager.cfg.hqp_control_port = closed_port()
    await manager.retarget()
    await advanced(clock, 2.0)
    assert manager.alarm is expected


# --- mode-name join -----------------------------------------------------------


@pytest.mark.parametrize(
    ("state", "lost", "expected"),
    [
        ({}, {"state": None}, ""),
        # a DAC that cannot do DSD enumerates no SDM entry while the engine still
        # reports mode index 2, so the join finds nothing — and naming some other
        # mode instead would report a mode the engine is not in
        ({"mode": "2", "_no_sdm": "1"}, {}, ""),
        ({}, {}, "PCM"),
    ],
    ids=["no_state_reading", "mode_index_absent_from_the_enum", "connected_in_pcm"],
)
async def test_current_mode_name_is_the_enumerated_name_of_the_engine_mode_and_empty_when_there_is_none(
    live_manager: LiveManager, state: dict[str, str], lost: dict[str, None], expected: str
) -> None:
    """``lost`` names the readings the ready manager no longer holds."""
    manager, _, _ = await live_manager(**state)
    for name, value in lost.items():
        setattr(manager.readings, name, value)
    assert engineread.current_mode_name(manager) == expected
