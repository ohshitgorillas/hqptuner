"""ConnectionManager write path through its public API (docs/testing.md).

The happy path runs the manager against the real-socket fake daemon: it
connects on its own, applies a live edit, and the report reflects the
State readback the daemon actually returns."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from hqptuner.config import Config
from hqptuner.control import ControlError
from hqptuner.lanes import livemap
from hqptuner.manager import ConnectionManager


async def _until_reachable(manager: ConnectionManager, timeout: float = 2.0) -> None:
    async def wait() -> None:
        while not manager.reachable:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), timeout)


@pytest.fixture
async def running_manager(live_daemon_port: int) -> AsyncIterator[ConnectionManager]:
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=live_daemon_port))
    task = asyncio.create_task(manager.run())
    await _until_reachable(manager)
    yield manager
    manager.stop()
    await task
    await manager.aclose()


@pytest.fixture
async def split_filter_manager(split_filter_daemon_port: int) -> AsyncIterator[ConnectionManager]:
    """Connected to the daemon whose two filter slots differ — see the fixture."""
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=split_filter_daemon_port))
    task = asyncio.create_task(manager.run())
    await _until_reachable(manager)
    yield manager
    manager.stop()
    await task
    await manager.aclose()


async def test_live_edit_applies_and_verifies(running_manager: ConnectionManager) -> None:
    report = await running_manager.apply({"shaper": {"value": "5"}}, {})
    assert report["live"][0]["ok"] is True


async def test_live_edit_without_connection_raises() -> None:
    manager = ConnectionManager(Config())
    with pytest.raises(ControlError, match="not connected"):
        await manager.apply({"shaper": {"value": "5"}}, {})


async def test_http_edit_without_credentials_reports_error() -> None:
    manager = ConnectionManager(Config())  # no http client configured
    report = await manager.apply({}, {"channels": "2"})
    assert report["persistent"]["submitted"] is False


# --- live routing of persistent form fields (lanes/livemap.py) ---------------
# Seven /config fields have exact Control API equivalents, so they apply live
# instead of riding a restart. The fake daemon starts in PCM (mode="1") with
# both filter slots at index 0, and enum 40 is poly-sinc-gauss-long at PCM index 1.


async def test_a_filter_change_applies_live(running_manager: ConnectionManager) -> None:
    report = await running_manager.apply({}, {"filter": "40"})
    assert next((r["ok"] for r in report["live"] if r["setting"] == "filter"), False) is True


async def test_a_fully_routable_batch_never_restarts_the_daemon(running_manager: ConnectionManager) -> None:
    report = await running_manager.apply({}, {"filter": "40"})
    assert report["persistent"] is None


async def test_a_one_sided_filter_edit_carries_its_sibling(split_filter_manager: ConnectionManager) -> None:
    # SetFilter `value` alone sets BOTH slots (protocol.md §6), so an Nx-only edit
    # must carry the current 1x explicitly or it silently clobbers it. This fake's
    # slots differ (1x=2, Nx=0), so a clobber reads back as a different index.
    live, _ = livemap.split_live(split_filter_manager, {"filter": "40"}, {})
    assert live["filter"]["value1x"] == "2"


async def test_an_enum_id_becomes_the_list_index_the_setter_wants(running_manager: ConnectionManager) -> None:
    live, _ = livemap.split_live(running_manager, {"filter": "40"}, {})
    assert live["filter"]["value"] == "1"


async def test_a_dormant_chains_field_stays_on_the_restore_lane(running_manager: ConnectionManager) -> None:
    _, rest = livemap.split_live(running_manager, {"oversampling": "38"}, {})
    assert rest == {"oversampling": "38"}


async def test_a_mode_change_beside_a_filter_defers_the_whole_batch(running_manager: ConnectionManager) -> None:
    _, rest = livemap.split_live(running_manager, {"mode": "sdm", "filter": "40"}, {})
    assert rest == {"mode": "sdm", "filter": "40"}


async def test_a_live_routed_filter_becomes_the_running_truth(running_manager: ConnectionManager) -> None:
    # The file still holds the old filter, so if this reported the file the
    # dropdown would snap back after Apply and re-picking the old value would
    # read as clean — leaving no way to select it again.
    await running_manager.apply({}, {"filter": "40"})
    assert livemap.live_overrides(running_manager)["filter"] == "40"


async def test_a_save_records_the_mode_the_engine_is_in(running_manager: ConnectionManager) -> None:
    assert livemap.live_overrides(running_manager)["mode"] == "pcm"


async def test_a_save_omits_the_dormant_chains_fields(running_manager: ConnectionManager) -> None:
    assert "oversampling" not in livemap.live_overrides(running_manager)
