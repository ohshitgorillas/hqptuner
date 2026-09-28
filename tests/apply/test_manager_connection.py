"""Connection-manager alarm bookkeeping and the mode-name join
(docs/testing.md): the alarm trips only past the threshold (in virtual time),
and the mode name is a join of the engine's State onto the modes enumeration."""

from conftest import LiveManager
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager

# --- the alarm: unreachable beyond the threshold ------------------------------


async def test_the_alarm_stays_quiet_inside_the_threshold_but_trips_once_past_it() -> None:
    # never-connected managers; the wait is paid in virtual time
    quiet = ConnectionManager(Config(alarm_threshold=60.0), clock=VirtualClock())
    inside_threshold = quiet.alarm
    tripped = ConnectionManager(Config(alarm_threshold=1.0), clock=VirtualClock())
    await tripped.clock.sleep(2.0)
    past_threshold = tripped.alarm
    assert (inside_threshold, past_threshold) == (False, True)


# --- mode-name join -----------------------------------------------------------


async def test_current_mode_name_is_empty_before_any_connection_but_named_once_connected(
    live_manager: LiveManager,
) -> None:
    unconnected = engineread.current_mode_name(ConnectionManager(Config()))
    manager, _, _ = await live_manager()
    connected = engineread.current_mode_name(manager)
    assert (unconnected, connected) == ("", "PCM")


async def test_current_mode_name_is_empty_when_the_modes_enum_has_no_such_index_but_named_when_it_does(
    live_manager: LiveManager,
) -> None:
    # a DAC that cannot do DSD enumerates no SDM entry while the engine still
    # reports mode index 2, so the join finds nothing — and naming some other
    # mode instead would report a mode the engine is not in
    unmatched, _, _ = await live_manager(mode="2", _no_sdm="1")
    no_match = engineread.current_mode_name(unmatched)
    matched, _, _ = await live_manager()
    named = engineread.current_mode_name(matched)
    assert (no_match, named) == ("", "PCM")
