"""ConnectionManager write path through its public API (docs/testing.md).

The happy path runs the manager against the real-socket fake daemon: it
connects on its own, applies a live edit, and the report reflects the
State readback the daemon actually returns."""

import asyncio
from collections.abc import AsyncIterator

import pytest
from conftest import LiveManager

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live import overrides, routing


@pytest.fixture
async def running_manager(live_daemon_port: int) -> AsyncIterator[ConnectionManager]:
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=live_daemon_port))
    task = asyncio.create_task(manager.run())
    yield manager
    manager.stop()
    await task
    await manager.aclose()


async def test_http_edit_without_credentials_reports_error() -> None:
    manager = ConnectionManager(Config())  # no http client configured
    report = await manager.applyops.apply({}, {"channels": "2"})
    assert report["persistent"]["submitted"] is False


# --- live routing of persistent form fields (lanes/live/routing.py) ---------------
# Seven /config fields have exact Control API equivalents, so they apply live
# instead of riding a restart. The fake daemon starts in PCM (mode="1") with
# both filter slots at index 0, and enum 40 is poly-sinc-gauss-long at PCM index 1.


async def test_a_dormant_chains_field_stays_on_the_restore_lane(running_manager: ConnectionManager) -> None:
    _, rest = routing.split_live(running_manager, {"oversampling": "38"}, {})
    assert rest == {"oversampling": "38"}


async def test_a_mode_change_beside_a_filter_defers_the_whole_batch(running_manager: ConnectionManager) -> None:
    _, rest = routing.split_live(running_manager, {"mode": "sdm", "filter": "40"}, {})
    assert rest == {"mode": "sdm", "filter": "40"}


async def test_a_save_omits_the_dormant_chains_fields(running_manager: ConnectionManager) -> None:
    assert "oversampling" not in overrides.live_overrides(running_manager)


# --- staged mode change routes live, mode first ------------------------------
# A batch carrying the output mode plus a chain field of the TARGET mode applies
# without touching the restore lane: SetMode goes first, then the chain field is
# resolved against the enumeration lists the switch produced (SetMode swaps the
# filter/shaper/rate lists wholesale — protocol.md §4). Enum "3" (ASDM7EC) exists
# only in the fake's SDM shaper list, so its verified landing proves the ordering.


async def test_a_mode_equal_to_the_running_mode_is_not_resent(live_manager: LiveManager) -> None:
    # SetMode is not free even when it changes nothing — it reloads the chain and
    # clears the engine's rate pin (protocol.md §6) — so the wire must show none.
    manager, log, _ = await live_manager()
    await manager.applyops.apply({}, {"mode": "pcm", "dither": "5"})
    assert "SetMode" not in [name for name, _attrs in log]


# A leftover field means the restore lane's restart is happening regardless, and
# that restart boots the daemon from its config file — a value applied live never
# reaches that file, so routing any of the batch live would revert it moments
# later. The whole batch rides the restore instead.
async def test_a_mode_batch_with_a_leftover_field_keeps_the_mode_off_the_live_lane(
    running_manager: ConnectionManager,
) -> None:
    report = await running_manager.applyops.apply({}, {"mode": "sdm", "modulator": "3", "channels": "2"})
    assert "mode" not in [r["setting"] for r in report["live"]]


async def test_a_mode_batch_with_a_leftover_field_keeps_the_chain_field_off_the_live_lane(
    running_manager: ConnectionManager,
) -> None:
    report = await running_manager.applyops.apply({}, {"mode": "sdm", "modulator": "3", "channels": "2"})
    assert "shaper" not in [r["setting"] for r in report["live"]]


async def test_the_leftover_field_rides_the_persistent_lane(running_manager: ConnectionManager) -> None:
    # running_manager has no HTTP credentials, so the restore lane reports the
    # submission it could not make rather than staying silent (persistent None).
    report = await running_manager.applyops.apply({}, {"mode": "sdm", "modulator": "3", "channels": "2"})
    assert report["persistent"]["submitted"] is False
