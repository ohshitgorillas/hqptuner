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

from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from conftest import DaemonFactory
from fake_control import restart_into
from narrow import FixtureError, present
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.applyops import ApplyReport, EngineApplyResult
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http.restore import RestoreOutcome
from hqptuner.presets import presetlane

if TYPE_CHECKING:
    import asyncio

#: What the 4321 fake is moved to when the restore lands: the engine that comes
#: back after the restart. SDM loaded, its chain enumerated, its own filter slot
#: — all three differ from the PCM engine the manager connected to, so a picture
#: carried over from before the restart is visible as the PCM reading surviving.
RESTARTED_INTO_SDM = {"mode": "2", "_active_mode": "SDM (DSD)", "filterNx": "2"}

#: What `_filter_nx` answers: the picture holds no State at all, its State
#: carries no ``filterNx``, or the ``filterNx`` of the engine that came back.
NO_STATE = "<no State>"
NO_FILTER_NX = "<no filterNx>"
POST_RESTORE_FILTER_NX = RESTARTED_INTO_SDM["filterNx"]

#: A manager on both lanes plus its 4321 fake's live State.
DualLane = Callable[..., Awaitable[tuple[ConnectionManager, dict[str, str]]]]


@pytest.fixture
async def dual_lane(daemon: DaemonFactory, http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[DualLane]:
    """A connected manager on both lanes — 4321 for the engine picture, 8088 for
    the restore a preset load rides — settled before it comes back.

    Keyword arguments are the control fake's State overrides, bar
    ``alarm_threshold``, which bounds the post-restore wait. The poll interval
    is left at the production pacing deliberately: the manager's own poll would
    otherwise refresh the picture the load is supposed to refresh."""
    built: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def build(*, alarm_threshold: float = 1.0, **overrides: str) -> tuple[ConnectionManager, dict[str, str]]:
        port, _log, state = await daemon(**overrides)
        http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            alarm_threshold=alarm_threshold,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        manager = ConnectionManager(cfg, http, VirtualClock())
        task = manager.clock.spawn(manager.run())
        built.append((manager, task, http))
        return manager, state

    yield build
    for manager, task, http in built:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


def _applied(report: ApplyReport) -> None:
    """A staged apply that reached the persistent lane, or a failure naming the
    setup that never got there — the restart is the premise of these cases, not
    the behavior under test, so it raises rather than spending an assertion."""
    if report.persistent is None or report.persistent.outcome is not RestoreOutcome.APPLIED:
        raise FixtureError(reason=f"the apply never reached the persistent lane: {report.persistent}")


def _submitted(result: EngineApplyResult) -> None:
    """An engine apply that reached the daemon, or a failure naming the setup
    that never got there. Same premise as ``_applied``: no restore, no restart,
    and nothing the case is about could have happened."""
    if result.backup_bytes <= 0:
        raise FixtureError(reason=f"the engine apply never reached the daemon: {result}")


# --- when the engine cannot be re-read, the picture is empty -----------------
# A stale reading is worse than none: everything that folds the picture into a
# saved config would write settings off a process that is gone.


def _filter_nx(manager: ConnectionManager) -> str:
    """The ``filterNx`` the manager's picture holds: ``NO_STATE`` or ``NO_FILTER_NX`` when it holds none."""
    state = manager.readings.state
    return NO_STATE if state is None else state.get("filterNx", NO_FILTER_NX)


async def _preset_load_with_no_control_connection(
    http_daemon: dict[str, Any], tmp_path: Path, _dual_lane: DualLane
) -> ConnectionManager:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    cfg = Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    manager = ConnectionManager(cfg, http, VirtualClock())
    try:
        await manager.presetops.save_preset("Stored")
        await presetlane.load(manager, "Stored")
    finally:
        await http.aclose()
    return manager


async def _staged_apply(http_daemon: dict[str, Any], _tmp_path: Path, dual_lane: DualLane) -> ConnectionManager:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _applied(await manager.applyops.apply({}, {"title": "Renamed"}))
    return manager


@pytest.mark.parametrize(
    ("write", "expected"),
    [
        pytest.param(_preset_load_with_no_control_connection, NO_STATE, id="preset-load-no-control-connection"),
        pytest.param(_staged_apply, POST_RESTORE_FILTER_NX, id="staged-apply"),
    ],
)
async def test_a_preset_load_with_no_control_connection_leaves_no_state_but_staged_apply_leaves_post_restore_state(
    http_daemon: dict[str, Any],
    tmp_path: Path,
    dual_lane: DualLane,
    write: Callable[[dict[str, Any], Path, DualLane], Awaitable[ConnectionManager]],
    expected: str,
) -> None:
    assert _filter_nx(await write(http_daemon, tmp_path, dual_lane)) == expected


# --- the other two restart-shaped writes -------------------------------------
# A preset load is not the only ``POST /restore``: a staged apply that reaches
# the persistent lane and an engine-attribute apply both restart the daemon the
# same way, so both leave the same picture of a process that no longer exists.


async def test_an_engine_apply_leaves_the_post_restore_state_in_the_picture(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: state.update(RESTARTED_INTO_SDM)
    _submitted(await manager.applyops.apply_engine({"cuda": "0"}))
    assert present(manager.readings.state).get("filterNx") == "2"


# --- what a preset load costs the 8088 lane ----------------------------------
# The restart a load triggers is followed by a whole connect body on the engine
# that came back, and that body already reads the settings archive, the forms and
# the device capability. A load that waited for it re-reads none of them.

#: A post-restore wait long enough for the reconnect after one refused connect
#: (the manager retries every ``RECONNECT_FAST`` second inside the window).
RECONNECT_WINDOW = 5.0


async def test_a_preset_load_whose_restart_reconnects_reads_the_settings_archive_twice(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the restart as the wire sees it: the control fake severs every connection,
    # turns the first reconnect away and comes back on the restored file. The
    # wait outlasts the manager's fast reconnect, so it sees the fresh connect.
    manager, state = await dual_lane(alarm_threshold=RECONNECT_WINDOW, _cfg_dither="0", _cfg_modulator="0")
    http_daemon["_on_restore"] = lambda: restart_into(
        state, http_daemon["mode"], http_daemon["dither"], http_daemon["modulator"]
    )
    await manager.connected.wait()
    await manager.presetops.save_preset("Stored")
    already_read = http_daemon["_backup_reads"]
    await presetlane.load(manager, "Stored")
    # the pre-restore backup the restore is built from, and the connect body's
    assert http_daemon["_backup_reads"] == already_read + 2
