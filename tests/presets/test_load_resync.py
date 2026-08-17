"""Loading a preset resyncs HQPTuner's picture of the engine (docs/testing.md —
behavior only, one assertion per test, public API only, fakes speak the wire
protocol).

``POST /restore`` RESTARTS hqplayerd (docs/protocol.md §3.6, modelled by the
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
from fake_config_xml import elem_attr
from narrow import present

from hqptuner.conf import presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live import lane
from hqptuner.presets import presetlane
from hqptuner.presets.presetstore import PresetStore

#: What the 4321 fake is moved to when the restore lands: the engine that comes
#: back after the restart. SDM loaded, its chain enumerated, its own filter slot
#: — all three differ from the PCM engine the manager connected to, so a picture
#: carried over from before the restart is visible as the PCM reading surviving.
RESTARTED_INTO_SDM = {"mode": "2", "_active_mode": "SDM (DSD)", "filterNx": "2"}

#: One filter both chains offer under different enum IDs: `sinc-M` is 23 on the
#: SDM chain and 25 on the PCM one (protocol.md §4 — the two chains number the
#: same names differently). Which ID is held for that one name says without
#: ambiguity which engine was enumerated, and says it without pinning the shape
#: of the rest of the list.
SINC_M = "sinc-M"
SINC_M_ON_THE_SDM_CHAIN = "23"

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
            lambda: manager.reachable and manager.state is not None and manager.loaded_at is not None,
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


def _pinned(manager: ConnectionManager) -> None:
    """A LIVE rate the manager is actually remembering, or a failure. Without
    it there is nothing for the restart to clear and the case proves nothing."""
    if not manager.live.rates:
        raise AssertionError("the LIVE rate write was never remembered: nothing for the restart to clear")


def _held(manager: ConnectionManager) -> None:
    """A chain edit the manager is actually holding, or a failure — same
    premise, for the dormant chain's half of the memory."""
    if not manager.live.chain:
        raise AssertionError("the LIVE chain edit was never held: nothing for the restart to clear")


def _filter_id(manager: ConnectionManager, name: str) -> str:
    """The enum ID the engine's current filter enumeration carries for a filter
    NAME, or "" when the enumerated chain does not offer it."""
    return next((item["value"] for item in present(manager.enums)["filters"] if item["name"] == name), "")


async def _stored_preset(manager: ConnectionManager) -> None:
    """A preset on disk for the load under test, captured off the running
    daemon so its restore archive is one the fake would accept."""
    await manager.presetops.save_preset("Stored")


# --- the LIVE memory is of an engine that is gone ----------------------------
# A LIVE rate pin and a held chain edit are memory of a running process: the
# daemon holds one rate pin and clears it on a mode switch, and the dormant
# chain cannot be told anything at all (docs/settings-classification.md). A
# restart takes both with it.


async def test_a_preset_load_clears_the_remembered_rate_pin(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"rate": "352800"})  # remembered under pcm
    _pinned(manager)
    await _stored_preset(manager)
    await presetlane.load(manager, "Stored")
    assert manager.live.rates == {}


async def test_a_preset_load_clears_the_held_chain_edit(dual_lane: DualLane) -> None:
    # enum 23 is `sinc-M` on the SDM chain, which is dormant under the PCM
    # engine the manager connected to, so the edit is held rather than written
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"oversampling": "23"})
    _held(manager)
    await _stored_preset(manager)
    await presetlane.load(manager, "Stored")
    assert manager.live.chain == {}


# --- the picture is re-read from the engine that came back -------------------


async def test_a_preset_load_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the manager connected to a PCM engine holding filter slot 0; the daemon
    # comes back from the restore in SDM holding slot 2
    manager, state = await dual_lane()
    await _stored_preset(manager)
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    await presetlane.load(manager, "Stored")
    assert present(manager.state).get("filterNx") == "2"


async def test_a_preset_load_leaves_the_post_restore_enumerations_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the manager connected to a PCM engine, which numbers `sinc-M` 25; the
    # daemon comes back in SDM, where the same filter is 23
    manager, state = await dual_lane()
    await _stored_preset(manager)
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    await presetlane.load(manager, "Stored")
    assert _filter_id(manager, SINC_M) == SINC_M_ON_THE_SDM_CHAIN


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
    assert manager.state is None


#: The restarted daemon takes the post-restore `State` read down with it: the
#: command is received and the socket closes under the client with nothing
#: coming back, which the client raises as a `ControlError`. That — not an error
#: document — is what a failed read looks like here: `State` is a getter, and
#: `result="OK"`/`result="Error"` is the SETTER reply shape (docs/protocol.md
#: §6), so an error document would come back as an ordinary reading.
STATE_READ_DIES = {"_close": "State"}


async def test_a_preset_load_whose_state_read_finds_the_connection_gone_leaves_no_state(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    await _stored_preset(manager)
    http_daemon["_on_restore"] = lambda: state.update(STATE_READ_DIES)
    await presetlane.load(manager, "Stored")
    assert manager.state is None


async def test_a_preset_load_whose_state_read_finds_the_connection_gone_still_loads(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the preset was restored; failing to re-read the engine afterwards is not
    # the load failing
    manager, state = await dual_lane()
    await _stored_preset(manager)
    http_daemon["_on_restore"] = lambda: state.update(STATE_READ_DIES)
    assert (await presetlane.load(manager, "Stored"))["active"] is True


# --- end to end: the auto-save after a load stores the loaded preset ---------
# The bug this exists for. Auto-save folds the engine picture into the active
# preset's stored XML, so a picture left over from the preset that was active
# BEFORE the load is written straight over the settings of the preset that was
# just loaded.


async def _autosaved_after_loading_a(
    dual_lane: DualLane,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    stored_in_a: dict[str, str],
    restarted_as: dict[str, str],
) -> PresetStore:
    """The bug's own sequence: preset "B" active on an SDM engine, preset "A"
    on disk carrying ``stored_in_a``, auto-save armed. Loading A restarts the
    daemon into ``restarted_as``, and the auto-save that follows folds the
    engine picture into A. Hands back the store to read A out of."""
    manager, state = await dual_lane(mode="2", _active_mode="SDM (DSD)")
    await manager.presetops.save_preset("B")
    store = PresetStore(tmp_path / "presets")
    store.save("A", presetconf.apply_edits(store.read("B"), stored_in_a))
    store.set_autosave(enabled=True)
    http_daemon["_on_restore"] = lambda: state.update(restarted_as)
    await presetlane.load(manager, "A")
    await presetlane.autosave(manager)
    return store


async def test_an_autosave_after_a_load_stores_the_post_restore_engine_filter(
    dual_lane: DualLane, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # The biting half of the end-to-end case. A's file says enum 40
    # (`poly-sinc-gauss-long`); the daemon comes back from A's restore running
    # PCM with filter slot 2 loaded, which that chain numbers 25 (`sinc-M`). So
    # 25 is a value NEITHER A's file NOR the pre-load engine could have
    # supplied: before the load the engine was in SDM, where the PCM filter is
    # dormant and contributes nothing. Only a fold off the post-restore reading
    # puts it in A.
    store = await _autosaved_after_loading_a(
        dual_lane,
        http_daemon,
        tmp_path,
        {"mode": "pcm", "filter": "40"},
        {"mode": "1", "_active_mode": "PCM", "filterNx": "2"},
    )
    assert elem_attr(store.read("A"), "pcm", "filter") == "25"


async def test_an_autosave_after_a_load_does_not_store_the_pre_load_engine_mode(
    dual_lane: DualLane, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # The field the bug was reported on. "B" was active on an SDM engine; A's
    # own output mode is PCM and the daemon comes back from A's restore running
    # PCM, as A's config says. A fold off the pre-load picture writes `sdm` into
    # A — B's engine mode, stored as A's.
    store = await _autosaved_after_loading_a(
        dual_lane, http_daemon, tmp_path, {"mode": "pcm"}, {"mode": "1", "_active_mode": "PCM"}
    )
    assert elem_attr(store.read("A"), "mode", "value") == "pcm"


# --- the other two restart-shaped writes -------------------------------------
# A preset load is not the only ``POST /restore``: a staged apply that reaches
# the persistent lane and an engine-attribute apply both restart the daemon the
# same way, so both leave the same picture of a process that no longer exists.


async def test_a_staged_apply_clears_the_remembered_rate_pin(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"rate": "352800"})
    _pinned(manager)
    _applied(dict(await manager.applyops.apply({}, {"title": "Renamed"})))
    assert manager.live.rates == {}


async def test_a_staged_apply_clears_the_held_chain_edit(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"oversampling": "23"})
    _held(manager)
    _applied(dict(await manager.applyops.apply({}, {"title": "Renamed"})))
    assert manager.live.chain == {}


async def test_a_staged_apply_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _applied(dict(await manager.applyops.apply({}, {"title": "Renamed"})))
    assert present(manager.state).get("filterNx") == "2"


async def test_an_engine_apply_clears_the_remembered_rate_pin(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"rate": "352800"})
    _pinned(manager)
    _submitted(dict(await manager.applyops.apply_engine({"cuda": "0"})))
    assert manager.live.rates == {}


async def test_an_engine_apply_clears_the_held_chain_edit(dual_lane: DualLane) -> None:
    manager, _state = await dual_lane()
    await lane.apply_now(manager, {"oversampling": "23"})
    _held(manager)
    _submitted(dict(await manager.applyops.apply_engine({"cuda": "0"})))
    assert manager.live.chain == {}


async def test_an_engine_apply_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _submitted(dict(await manager.applyops.apply_engine({"cuda": "0"})))
    assert present(manager.state).get("filterNx") == "2"
