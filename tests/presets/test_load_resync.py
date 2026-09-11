"""Loading a preset resyncs HQPTuner's picture of the engine (docs/testing.md —
behavior only, one assertion per test, public API only, fakes speak the wire
protocol).

``POST /restore`` RESTARTS hqplayerd (docs/protocol.md §3.6, modeled by the
8088 fake's ``_on_restore`` hook), so once a preset load returns, every reading
HQPTuner holds about the engine — the ``State`` snapshot, the enumerations, and
the LIVE memory of settings the engine cannot carry across a mode/chain change —
describes a process that no longer exists. The contract asserted here: the
manager's picture after a load is the picture of the engine that came back, or
nothing at all, and never the one held before.

The 4321 fake is moved from inside the 8088 fake's restore, the way
``test_rescan_replay`` moves it from inside the rescan — so what the manager is
holding afterwards is compared against the engine the daemon actually came back
as, never against a value the test handed it.

The managers here run at the production poll pacing, so no background poll
interleaves with the load: what the picture holds when the load returns is what
the load itself put there.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, eventually
from narrow import present

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live import lane
from hqptuner.presets import presetlane

#: What the 4321 fake is moved to when the restore lands: the engine that comes
#: back after the restart. SDM loaded, its chain enumerated, its own filter slot
#: — all three differ from the PCM engine the manager connected to, so a picture
#: carried over from before the restart is visible as the PCM reading surviving.
RESTARTED_INTO_SDM = {"mode": "2", "_active_mode": "SDM (DSD)", "filterNx": "2"}

#: A manager on both lanes plus its 4321 fake's live State.
DualLane = Callable[..., Awaitable[tuple[ConnectionManager, dict[str, str]]]]


@pytest.fixture
async def dual_lane(daemon: DaemonFactory, http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[DualLane]:
    """A connected manager on both lanes — 4321 for the engine picture, 8088 for
    the restore a preset load rides — settled before it comes back.

    Keyword arguments are the control fake's State overrides. The poll interval
    is left at the production pacing deliberately: the manager's own poll would
    otherwise refresh the picture the load is supposed to refresh."""
    built: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def build(**overrides: str) -> tuple[ConnectionManager, dict[str, str]]:
        port, _log, state = await daemon(**overrides)
        http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            alarm_threshold=1.0,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        manager = ConnectionManager(cfg, http)
        task = asyncio.create_task(manager.run())
        await eventually(
            lambda: manager.reachable and manager.readings.state is not None and manager.readings.loaded_at is not None,
            timeout=5.0,
        )
        built.append((manager, task, http))
        return manager, state

    yield build
    for manager, task, http in built:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


def _applied(report: dict[str, Any]) -> None:
    """A staged apply that reached the persistent lane, or a failure naming the
    setup that never got there — the restart is the premise of these cases, not
    the behavior under test, so it raises rather than spending an assertion."""
    if not report["persistent"]["applied"]:
        raise AssertionError(f"the apply never reached the persistent lane: {report['persistent']}")


def _submitted(result: dict[str, Any]) -> None:
    """An engine apply that reached the daemon, or a failure naming the setup
    that never got there. Same premise as ``_applied``: no restore, no restart,
    and nothing the case is about could have happened."""
    if not result["submitted"]:
        raise AssertionError(f"the engine apply never reached the daemon: {result}")


def _held(manager: ConnectionManager) -> None:
    """A chain edit the manager is actually holding, or a failure — same
    premise, for the dormant chain's half of the memory."""
    if not manager.readings.live.chain:
        raise AssertionError("the LIVE chain edit was never held: nothing for the restart to clear")


# --- when the engine cannot be re-read, the picture is empty -----------------
# A stale reading is worse than none: everything that folds the picture into a
# saved config would write settings off a process that is gone.


async def test_a_preset_load_with_no_control_connection_leaves_no_state(
    http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    cfg = Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    manager = ConnectionManager(cfg, http)
    try:
        await manager.presetops.save_preset("Stored")
        await presetlane.load(manager, "Stored")
    finally:
        await http.aclose()
    assert manager.readings.state is None


# --- the other two restart-shaped writes -------------------------------------
# A preset load is not the only ``POST /restore``: a staged apply that reaches
# the persistent lane and an engine-attribute apply both restart the daemon the
# same way, so both leave the same picture of a process that no longer exists.


async def test_a_staged_apply_clears_the_held_chain_edit(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"oversampling": "23"})
    _held(manager)
    _applied(dict(await manager.applyops.apply({}, {"title": "Renamed"})))
    assert manager.readings.live.chain == {}


async def test_a_staged_apply_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _applied(dict(await manager.applyops.apply({}, {"title": "Renamed"})))
    assert present(manager.readings.state).get("filterNx") == "2"


async def test_an_engine_apply_clears_the_held_chain_edit(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"oversampling": "23"})
    _held(manager)
    _submitted(dict(await manager.applyops.apply_engine({"cuda": "0"})))
    assert manager.readings.live.chain == {}


async def test_an_engine_apply_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _submitted(dict(await manager.applyops.apply_engine({"cuda": "0"})))
    assert present(manager.readings.state).get("filterNx") == "2"
