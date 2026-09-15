"""Connection-manager alarm bookkeeping and the mode-name join
(docs/testing.md): the alarm trips only past the threshold (in virtual time),
and the mode name is a join of the engine's State onto the modes enumeration."""

from conftest import LiveManager

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager

# --- the alarm: unreachable beyond the threshold ------------------------------


async def test_alarm_stays_quiet_inside_the_threshold() -> None:
    manager = ConnectionManager(Config(alarm_threshold=60.0))
    assert manager.alarm is False


async def test_alarm_trips_once_unreachable_past_the_threshold() -> None:
    # never-connected manager; the wait is paid in virtual time (conftest clock)
    manager = ConnectionManager(Config(alarm_threshold=1.0))
    await manager.sleep(2.0)
    assert manager.alarm is True


# --- mode-name join -----------------------------------------------------------


def test_current_mode_name_is_empty_before_any_connection() -> None:
    assert engineread.current_mode_name(ConnectionManager(Config())) == ""


async def test_current_mode_name_is_empty_when_the_modes_enum_has_no_such_index(
    live_manager: LiveManager,
) -> None:
    # a DAC that cannot do DSD enumerates no SDM entry while the engine still
    # reports mode index 2, so the join finds nothing — and naming some other
    # mode instead would report a mode the engine is not in
    manager, _, _ = await live_manager(mode="2", _no_sdm="1")
    assert engineread.current_mode_name(manager) == ""
