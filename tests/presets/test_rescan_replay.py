"""A device rescan re-asserts the engine's live settings afterwards
(docs/testing.md — behavior only, one assertion per test, public API only,
fakes speak the wire protocol).

`GET /config/refresh` re-scans the daemon's output devices, and on 6.0.4 it
stops the engine while it does: every live-only setting — output mode, both
chains' filter and shaper, adaptive volume, the rate pin, the junk filter —
comes back at the config file's value, because a control-lane write never
reached that file. With auto-save on, `refresh_devices` puts back what the
ENGINE held before the rescan, so the rescan costs the user nothing they had
set live.

The engine's side of the rescan is modeled where it happens: the 8088 fake
runs the test's `_on_refresh` callable when the rescan lands, and that callable
moves the 4321 fake's State to the file's values. So every assertion below is
on the state the control daemon ends in, or on the commands that reached it —
never on how the replay was produced. Auto-save is the gate and the store is
NOT the source: the values replayed are the engine's own.

Two of the settings are engine-only in the strong sense. The rate pin is the
exact output rate (`SetRate`, index into the mode-dependent `RatesItem` ladder,
protocol.md §6) — a different slot from the config form's
`defaults_samplerate`/`defaults_bitrate` per-family ceiling — and `SetMode`
clears it outright, so a replay carrying both has to land the rate after the
mode. The junk filter has no `/config` form field at all, so the engine is the
only place it exists.

The `restored` mapping is read as reporting each setting under the field name
the engine's live record knows it by, carrying that record's value: the enum ID
for an enumerated field (`filter` 40, `dither` 5), the form's own word for the
mode (`pcm`), the rate in Hz, and the bare flag for adaptive volume. That is the
reading `tests/apply/test_live_snapshot.py` pins for those same names.
"""

from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, StartManager
from fake_control import CommandLog
from narrow import present

from hqptuner.conf import presetconf
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import rescan
from hqptuner.presets.store.presets import PresetStore

#: What the engine holds before the rescan: PCM loaded, both filter slots at
#: index 1 (poly-sinc-gauss-long), the NS9 shaper, adaptive volume on, the rate
#: pinned at PCM index 2 (352800 Hz), the 20k junk filter engaged and a matrix
#: profile loaded. Every one of them differs from what the stopped engine comes
#: back at, below.
ENGINE_HELD = {
    "mode": "1",
    "filter1x": "1",
    "filterNx": "1",
    "shaper": "1",
    "adaptive": "1",
    "rate": "2",
    "filter_junk": "1",
    "matrix_profile": "Default",
}

#: Where the rescan drops them — the config file's values, which the live lane
#: never wrote to. The file's mode is SDM, so a rescan costs the user the whole
#: chain and putting it back means a mode switch first.
ENGINE_AFTER_RESCAN = {
    "mode": "2",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "adaptive": "0",
    "rate": "0",
    "filter_junk": "0",
}

#: Every command the fake APPLIES to its State — the write side of the lane, as
#: `fake_control.apply_setter` defines it. A `Set` prefix is not the same set:
#: it misses `MatrixSetProfile`, the one thing a rescan deliberately does not
#: replay, and `Volume`.
EVERY_SETTER = "SetMode SetFilter SetShaping SetRate SetAdaptiveVolume SetJunkFilter Volume MatrixSetProfile"
SETTERS = frozenset(EVERY_SETTER.split())


def _setters(log: CommandLog) -> list[tuple[str, str]]:
    """The live setters that reached the daemon, in order, with their value."""
    return [(name, attrs.get("value", "")) for name, attrs in log if name in SETTERS]


def _sent(log: CommandLog) -> list[str]:
    """Every command the daemon was asked, in order — reads included, so what
    sits BETWEEN two setters is visible."""
    return [name for name, _ in log]


def _at(sent: list[str], name: str) -> int:
    """Where a command first reached the daemon, or -1 if it never did."""
    return sent.index(name) if name in sent else -1


def _next_after_the_mode_switch(sent: list[str]) -> str:
    """The command the daemon was asked immediately after the first `SetMode`.

    Answers `"SetMode"` — a setter, so a caller asserting "not a setter" fails —
    when there was no mode switch at all or nothing followed it, since neither
    is a mode switch that was verified before the next write."""
    at = _at(sent, "SetMode")
    if at < 0:
        return "SetMode"
    rest = sent[at + 1 :]
    return rest[0] if rest else "SetMode"


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
HELD_BY_THE_ENGINE = [
    ("adaptive", "1"),
    ("filterNx", "1"),
    ("filter1x", "1"),
    ("shaper", "1"),
    ("mode", "1"),
    ("rate", "2"),
    ("filter_junk", "1"),
]


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
    await engineread.refresh_devices(manager)
    assert state[reported] == held


#: The same settings as the caller is told about them: the field name each is
#: known by, carrying the engine's own value for it.
RESTORED_BY_THE_ENGINE = [
    ("adaptive_volume", "1"),
    ("filter", "40"),
    ("dither", "5"),
    ("mode", "pcm"),
    ("rate", "352800"),
    ("junk_filter", "1"),
]


@pytest.mark.parametrize(("field", "value"), RESTORED_BY_THE_ENGINE)
async def test_a_rescan_reports_the_value_it_put_back(
    daemon: DaemonFactory,
    start_manager: StartManager,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    *,
    field: str,
    value: str,
) -> None:
    # `restored` is keyed by the field name the setting is known by, so the
    # caller can say which settings the rescan cost and what they came back as
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert (await engineread.refresh_devices(manager))["restored"][field] == value


# --- the order the replay has to go in ---------------------------------------
# `SetMode` swaps the enumeration lists and clears the rate pin outright
# (protocol.md §6, probe-verified on 6.0.4), so the mode goes first and alone,
# and everything the switch would have wiped goes after it.


async def test_a_rescan_replays_the_output_mode_before_any_other_setting(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    before = len(log)
    await engineread.refresh_devices(manager)
    assert [name for name, _ in _setters(log[before:])][:1] == ["SetMode"]


async def test_a_replayed_mode_switch_carries_no_other_setter_with_it(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the switch is verified before the next write, or the write lands against
    # enumerations the switch was still moving
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    before = len(log)
    await engineread.refresh_devices(manager)
    assert _next_after_the_mode_switch(_sent(log[before:])) not in SETTERS


async def test_a_rescan_pins_the_rate_after_the_mode_switch(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # a rate pinned before the switch is the pin the switch clears
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    before = len(log)
    await engineread.refresh_devices(manager)
    sent = _sent(log[before:])
    assert _at(sent, "SetRate") > _at(sent, "SetMode") >= 0


# --- what a rescan never replays ---------------------------------------------


async def test_a_rescan_never_reloads_the_matrix_profile(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # a profile load needs live playback, so it is the one live setting the
    # rescan leaves alone — which is exactly what the field's caption promises
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    before = len(log)
    await engineread.refresh_devices(manager)
    assert "MatrixSetProfile" not in _sent(log[before:])


# --- auto-save off: the rescan writes nothing to the engine ------------------


async def test_a_rescan_with_autosave_off_sends_no_live_setters(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=False)
    before = len(log)
    await engineread.refresh_devices(manager)
    assert _setters(log[before:]) == []


@pytest.mark.parametrize("reported", ["rate", "filter_junk"])
async def test_a_rescan_with_autosave_off_leaves_the_engine_where_the_rescan_left_it(
    daemon: DaemonFactory,
    start_manager: StartManager,
    http_daemon: dict[str, Any],
    tmp_path: Path,
    *,
    reported: str,
) -> None:
    # the engine-only settings are on the same gate as every other live one
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=False)
    await engineread.refresh_devices(manager)
    assert state[reported] == ENGINE_AFTER_RESCAN[reported]


# --- nothing live to carry ----------------------------------------------------
# A connected manager whose engine is ALREADY sitting at the config file's
# values: the rescan stops it and it comes back exactly where it was, so there
# is nothing the user set live to lose. The lane is up and auto-save is on, so
# anything written here is a write the rescan had no reason to make.


async def _nothing_to_carry(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> tuple[ConnectionManager, CommandLog]:
    manager, log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, matrix_profile="", **ENGINE_AFTER_RESCAN
    )
    return manager, log


async def test_a_rescan_with_no_live_settings_held_sends_no_live_setters(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, log = await _nothing_to_carry(daemon, start_manager, http_daemon, tmp_path)
    before = len(log)
    await engineread.refresh_devices(manager)
    assert _setters(log[before:]) == []


async def test_a_rescan_with_no_live_settings_held_reports_an_empty_restored_mapping(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log = await _nothing_to_carry(daemon, start_manager, http_daemon, tmp_path)
    assert (await engineread.refresh_devices(manager))["restored"] == {}


# --- the replay is best-effort ------------------------------------------------
# Every live setter answers OK and applies nothing (`_deaf`, protocol.md §6), so
# the verify readback can never agree — and the rescan still succeeded.


async def _deaf_replay(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> dict[str, Any]:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _deaf=EVERY_SETTER
    )
    return dict(await engineread.refresh_devices(manager))


async def test_a_rescan_whose_replay_fails_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    assert (await _deaf_replay(daemon, start_manager, http_daemon, tmp_path))["refreshed"] is True


async def test_a_rescan_whose_replay_fails_restores_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # nothing verified by readback, so nothing may be reported as put back
    assert (await _deaf_replay(daemon, start_manager, http_daemon, tmp_path))["restored"] == {}


async def test_a_rescan_whose_replay_fails_warns_the_user(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    assert (await _deaf_replay(daemon, start_manager, http_daemon, tmp_path))["warning"] == rescan.NO_DAEMON


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
    await engineread.refresh_devices(manager)
    assert state["adaptive"] == "1"


# --- unchanged: the rescan itself still does what it always did --------------


async def test_a_rescan_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert (await engineread.refresh_devices(manager))["refreshed"] is True


async def test_a_rescan_offers_a_device_that_only_the_new_scan_found(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the endpoint is powered off until the rescan, so it can only be offered if
    # the /config form was refetched after it
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_hidden_endpoints"] = ["S99/hw:CARD=WokeUp,DEV=0"]
    await engineread.refresh_devices(manager)
    fields = present(manager.readings.config_form)["fields"]
    offered = {o["value"] for f in fields if f["name"] == "net_device" for o in f["options"]}
    assert "S99/hw:CARD=WokeUp,DEV=0" in offered


async def test_a_rescan_refetches_the_matrix_form(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the daemon's active profile moves behind the manager's back; only a
    # refetched /matrix reports it
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    await engineread.refresh_devices(manager)
    assert present(manager.readings.matrix_form)["active"] == "Mch-to-Stereo mixdown"


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
    "GetModes GetFilters GetShapers GetRates GetJunkFilters " + EVERY_SETTER
)


async def test_a_rescan_the_control_lane_never_returns_from_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await engineread.refresh_devices(manager))["refreshed"] is True


async def test_a_rescan_the_control_lane_never_returns_from_restores_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await engineread.refresh_devices(manager))["restored"] == {}


# --- the replay raising mid-write --------------------------------------------
# Distinct from a setter that answers OK and applies nothing (above): here the
# socket goes away underneath the write, so the lane raises rather than
# reporting a setting that did not verify. The daemon is otherwise healthy —
# it answers every read, and drops the connection only on a write — so this is
# the replay failing, not the lane being gone.


async def test_a_rescan_whose_replay_raises_still_reports_refreshed(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await engineread.refresh_devices(manager))["refreshed"] is True


async def test_a_rescan_whose_replay_raises_restores_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await engineread.refresh_devices(manager))["restored"] == {}


# --- what the user is told when the settings could not be put back -----------
# The failures above are silent otherwise: the rescan succeeded, the devices
# are re-scanned, and the settings the user had set live are quietly gone. The
# `warning` key is the sentence that says so, and it has to name what was lost
# rather than merely being a non-empty string. It is ABSENT when there is
# nothing to say — a bar that renders whatever is in that slot must not be
# handed an empty string to show.


async def test_a_rescan_the_control_lane_never_returns_from_warns_the_user(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
    assert (await engineread.refresh_devices(manager))["warning"] == rescan.NO_DAEMON


async def test_a_rescan_whose_replay_raises_warns_the_user(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(
        daemon, start_manager, http_daemon, tmp_path, autosave=True, _close=EVERY_SETTER
    )
    assert (await engineread.refresh_devices(manager))["warning"] == rescan.WRITE_FAILED


async def test_a_rescan_that_put_everything_back_warns_about_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=True)
    assert "warning" not in await engineread.refresh_devices(manager)


async def test_a_rescan_with_autosave_off_warns_about_nothing(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # nothing was going to be put back, so nothing was lost to report
    manager, _log, _state = await _rescanning(daemon, start_manager, http_daemon, tmp_path, autosave=False)
    assert "warning" not in await engineread.refresh_devices(manager)
