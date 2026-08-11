"""A device rescan re-asserts the engine's live settings afterwards
(docs/testing.md — behavior only, one assertion per test, public API only,
fakes speak the wire protocol).

`GET /config/refresh` re-scans the daemon's output devices, and on 6.0.4 it
stops the engine while it does: every live-only setting — output mode, both
chains' filter and shaper, adaptive volume, the per-family rate limits — comes
back at the config file's value, because a control-lane write never reached
that file. With auto-save on, `refresh_devices` puts back what the ENGINE held
before the rescan, so the rescan costs the user nothing they had set live.

The engine's side of the rescan is modelled where it happens: the 8088 fake
runs the test's `_on_refresh` callable when the rescan lands, and that callable
moves the 4321 fake's State to the file's values. So every assertion below is
on the state the control daemon ends in, or on the commands that reached it —
never on how the replay was produced. Auto-save is the gate and the store is
NOT the source: the values replayed are the engine's own.
"""

from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, ManagerFactory, StartManager
from fake_control import CommandLog
from narrow import present

from hqptuner.conf import presetconf
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.presetstore import PresetStore

#: What the engine holds before the rescan: PCM loaded, both filter slots at
#: index 1 (poly-sinc-gauss-long), the NS9 shaper, adaptive volume on. Every
#: one of them differs from what the stopped engine comes back at, below.
ENGINE_HELD = {"mode": "1", "filter1x": "1", "filterNx": "1", "shaper": "1", "adaptive": "1"}

#: Where the rescan drops them — the config file's values, which the live lane
#: never wrote to.
ENGINE_AFTER_RESCAN = {"filter1x": "0", "filterNx": "0", "shaper": "0", "adaptive": "0"}


def _setters(log: CommandLog) -> list[tuple[str, str]]:
    """The live setters that reached the daemon, in order, with their value.

    Everything the manager's poll sends is a `Get*`/`Status`/`State` read, so
    the `Set` prefix is exactly the write side of the control lane."""
    return [(name, attrs.get("value", "")) for name, attrs in log if name.startswith("Set")]


async def _rescanning(
    daemon: DaemonFactory,
    start_manager: StartManager,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    *,
    autosave: bool,
    **overrides: str,
) -> tuple[ConnectionManager, CommandLog, dict[str, str]]:
    """A manager on both lanes whose 4321 daemon is holding ENGINE_HELD, with
    the rescan wired to stop that engine. Hands back the manager, the control
    daemon's command log and its live State."""
    port, log, state = await daemon(**{**ENGINE_HELD, **overrides})
    manager = await start_manager(http_daemon["_port"], hqp_control_port=port, alarm_threshold=1.0)
    if autosave:
        PresetStore(tmp_path / "presets").set_autosave(enabled=True)
    http_daemon["_on_refresh"] = lambda: state.update(ENGINE_AFTER_RESCAN)
    return manager, log, state


# --- with auto-save on, what the engine held comes back ----------------------


#: One live-only setting per case, named as the daemon's own `State` reports it,
#: with the value the engine was holding before the rescan dropped it.
HELD_BY_THE_ENGINE = [("adaptive", "1"), ("filterNx", "1"), ("filter1x", "1"), ("shaper", "1")]


@pytest.mark.parametrize(("reported", "held"), HELD_BY_THE_ENGINE)
async def test_a_rescan_puts_the_engines_pre_rescan_setting_back(
    daemon: DaemonFactory,
    start_manager: StartManager,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    *,
    reported: str,
    held: str,
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    await manager.refresh_devices()
    assert state[reported] == held


async def test_a_rescan_reports_the_value_it_put_back(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # `restored` is keyed by config-form field name, so the caller can say which
    # settings the rescan cost and what they came back as
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert (await manager.refresh_devices())["restored"]["adaptive_volume"] == "1"


# --- auto-save off: the rescan writes nothing to the engine ------------------


async def test_a_rescan_with_autosave_off_sends_no_live_setters(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=False)
    before = len(log)
    await manager.refresh_devices()
    assert _setters(log[before:]) == []


# --- nothing live to carry: a manager that never reached the engine ----------
# `http_manager_factory` builds a manager on the 8088 fake alone and never
# connects it, so the engine holds nothing for the replay to carry. Its control
# port is pointed at a logged fake all the same: a replay that reached for the
# lane anyway would show up there.


async def _unconnected(
    daemon: DaemonFactory, http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], tmp_path: Path
) -> tuple[ConnectionManager, CommandLog]:
    port, log, _state = await daemon()
    PresetStore(tmp_path / "presets").set_autosave(enabled=True)
    manager = http_manager_factory(
        http_daemon, hqp_host="127.0.0.1", hqp_control_port=port, hqp_http_port=http_daemon["_port"]
    )
    return manager, log


async def test_a_rescan_with_no_live_settings_held_sends_no_live_setters(
    daemon: DaemonFactory, http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, log = await _unconnected(daemon, http_manager_factory, http_daemon, tmp_path)
    await manager.refresh_devices()
    assert _setters(log) == []


async def test_a_rescan_with_no_live_settings_held_reports_an_empty_restored_mapping(
    daemon: DaemonFactory, http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log = await _unconnected(daemon, http_manager_factory, http_daemon, tmp_path)
    assert (await manager.refresh_devices())["restored"] == {}


# --- the replay is best-effort ------------------------------------------------


async def test_a_rescan_whose_replay_fails_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # every live setter answers OK and applies nothing (`_deaf`, protocol.md §6),
    # so the verify readback can never agree — and the rescan still succeeded
    manager, _log, _state = await _rescanning(
        daemon,
        start_manager,
        http_daemon,
        tmp_path,
        autosave=True,
        _deaf="SetMode SetFilter SetShaping SetAdaptiveVolume SetRate",
    )
    assert (await manager.refresh_devices())["refreshed"] is True


# --- the engine is the source, never the store -------------------------------


async def test_the_replay_carries_the_engines_value_and_not_the_stored_one(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the active preset's snapshot is edited on disk to disagree with the engine
    # (the shape test_restart_survival uses): stored adaptive volume off, engine
    # adaptive volume on. The engine's own value is what must come back — and it
    # is the reading a store-sourced replay could not produce, since the rescan
    # left the engine at the stored value.
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    await manager.presetops.save_preset("Kept")
    store = PresetStore(tmp_path / "presets")
    store.save("Kept", presetconf.apply_edits(store.read("Kept"), {"adaptive_volume": "0"}))
    store.set_active("Kept")
    await manager.refresh_devices()
    assert state["adaptive"] == "1"


# --- unchanged: the rescan itself still does what it always did --------------


async def test_a_rescan_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert (await manager.refresh_devices())["refreshed"] is True


async def test_a_rescan_offers_a_device_that_only_the_new_scan_found(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the endpoint is powered off until the rescan, so it can only be offered if
    # the /config form was refetched after it
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_hidden_endpoints"] = ["S99/hw:CARD=WokeUp,DEV=0"]
    await manager.refresh_devices()
    fields = present(manager.config_form)["fields"]
    offered = {o["value"] for f in fields if f["name"] == "net_device" for o in f["options"]}
    assert "S99/hw:CARD=WokeUp,DEV=0" in offered


async def test_a_rescan_refetches_the_matrix_form(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the daemon's active profile moves behind the manager's back; only a
    # refetched /matrix reports it
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    await manager.refresh_devices()
    assert present(manager.matrix_form)["active"] == "Mch-to-Stereo mixdown"


# --- the daemon that never comes back ----------------------------------------
# The replay waits for the control lane to settle, and the wait is bounded by
# the alarm threshold. A daemon that accepts every connection and drops it
# again — received, logged, nothing answered, socket gone — never settles, so
# the wait runs out. Nothing about that may cost the rescan its result.

#: Every command the fake knows, so `_close` covers the whole lane rather than
#: one command: a daemon that is up enough to accept a socket and answers
#: nothing on it, for as long as the test lasts.
EVERY_COMMAND = (
    "GetInfo GetLicense ConfigurationGet MatrixListProfiles MatrixGetProfile State VolumeRange Status "
    "GetModes GetFilters GetShapers GetRates GetJunkFilters "
    "SetMode SetFilter SetShaping SetRate SetAdaptiveVolume SetJunkFilter Volume MatrixSetProfile"
)


async def test_a_rescan_the_control_lane_never_returns_from_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await manager.refresh_devices())["refreshed"] is True


async def test_a_rescan_the_control_lane_never_returns_from_restores_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await manager.refresh_devices())["restored"] == {}


# --- the replay raising mid-write --------------------------------------------
# Distinct from a setter that answers OK and applies nothing (above): here the
# socket goes away underneath the write, so the lane raises rather than
# reporting a setting that did not verify. The daemon is otherwise healthy —
# it answers every read, and drops the connection only on a write — so this is
# the replay failing, not the lane being gone.

#: The write side of the lane, and only it: reads are answered normally, so the
#: manager settles and the replay starts — and then dies on its first setter.
EVERY_SETTER = "SetMode SetFilter SetShaping SetRate SetAdaptiveVolume SetJunkFilter Volume MatrixSetProfile"


async def test_a_rescan_whose_replay_raises_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await manager.refresh_devices())["refreshed"] is True


async def test_a_rescan_whose_replay_raises_restores_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await manager.refresh_devices())["restored"] == {}


# --- what the user is told when the settings could not be put back -----------
# Both failures above are silent otherwise: the rescan succeeded, the devices
# are re-scanned, and the settings the user had set live are quietly gone. The
# `warning` key is the sentence that says so. It is ABSENT when there is nothing
# to say — a bar that renders whatever is in that slot must not be handed an
# empty string to show.


async def test_a_rescan_the_control_lane_never_returns_from_warns_the_user(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await manager.refresh_devices())["warning"]


async def test_a_rescan_whose_replay_raises_warns_the_user(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await manager.refresh_devices())["warning"]


async def test_a_rescan_that_put_everything_back_warns_about_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert "warning" not in await manager.refresh_devices()


async def test_a_rescan_with_autosave_off_warns_about_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # nothing was going to be put back, so nothing was lost to report
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=False)
    assert "warning" not in await manager.refresh_devices()
