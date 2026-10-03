"""A device rescan re-asserts the engine's live settings afterwards
(docs/testing.md — behavior only, one assertion per test, public API only,
fakes speak the wire protocol).

`GET /config/refresh` re-scans the daemon's output devices, and on 6.0.4 it
stops the engine while it does: every live-only setting — output mode, both
chains' filter and shaper, adaptive volume, the junk filter — comes back at the
config file's value, because a control-lane write never reached that file. With
auto-save on, `refresh_devices` puts back what the ENGINE held before the
rescan, so the rescan costs the user nothing they had set live.

The engine's side of the rescan is modeled where it happens: the 8088 fake
runs the test's `_on_refresh` callable when the rescan lands, and that callable
moves the 4321 fake's State to the file's values. So every assertion below is
on the state the control daemon ends in, or on the commands that reached it —
never on how the replay was produced. Auto-save is the gate and the store is
NOT the source: the values replayed are the engine's own.

The junk filter is engine-only in the strong sense: it has no `/config` form
field at all, so the engine is the only place it exists.

The `restored` mapping is read as reporting each setting under the field name
the engine's live record knows it by, carrying that record's value: the enum ID
for an enumerated field (`filter` 40, `dither` 5), the form's own word for the
mode (`pcm`), and the bare flag for adaptive volume. That is the reading
`tests/apply/test_live_snapshot.py` pins for those same names.
"""

import contextlib
from collections.abc import Awaitable, Callable, Iterator
from pathlib import Path
from typing import Any

import fixtures_clients
import pytest
from apps import wait_for_api
from conftest import DaemonFactory, StartManager, spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog
from fastapi.testclient import TestClient
from narrow import present

from hqptuner.conf import presetconf
from hqptuner.core import engineread
from hqptuner.core.engineread import RescanReport
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.rescan import ReplayOutcome
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

#: What putting ENGINE_HELD back sends, in order: the mode first, so the rest
#: resolves against the chain it loads. The rate is a persistent limit the rescan
#: leaves alone, and the matrix profile is never replayed.
HELD_SETTERS = [
    ("SetMode", ENGINE_HELD["mode"]),
    ("SetFilter", ENGINE_HELD["filterNx"]),
    ("SetShaping", ENGINE_HELD["shaper"]),
    ("SetJunkFilter", ENGINE_HELD["filter_junk"]),
    ("SetAdaptiveVolume", ENGINE_HELD["adaptive"]),
]

#: The same settings as the engine's live record names them: the enum ID the
#: fake's enumeration gives index 1 on the PCM chain (filter 40, dither 5), the
#: form's word for the mode, and the bare flags.
HELD_RESTORED = {
    "mode": "pcm",
    "filter": "40",
    "filter1x": "40",
    "dither": "5",
    "adaptive_volume": ENGINE_HELD["adaptive"],
    "junk_filter": ENGINE_HELD["filter_junk"],
}


def _setters(log: CommandLog) -> list[tuple[str, str]]:
    """The live setters that reached the daemon, in order, with their value."""
    return [(name, attrs.get("value", "")) for name, attrs in log if name in SETTERS]


def _sent(log: CommandLog) -> list[str]:
    """Every command the daemon was asked, in order — reads included, so what
    sits BETWEEN two setters is visible."""
    return [name for name, _ in log]


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
    manager = await start_manager(http_daemon["_port"], hqp_control_port=port, alarm_threshold=0.05)
    if autosave:
        PresetStore(tmp_path / "presets").set_autosave(enabled=True)
    http_daemon["_on_refresh"] = lambda: state.update(ENGINE_AFTER_RESCAN)
    return manager, log, state


#: Every command the fake knows, so `_close` covers the whole lane rather than
#: one command: a daemon that is up enough to accept a socket and answers
#: nothing on it, for as long as the test lasts.
EVERY_COMMAND = (
    "GetInfo GetLicense ConfigurationGet MatrixListProfiles MatrixGetProfile State VolumeRange Status "
    "GetModes GetFilters GetShapers GetRates GetJunkFilters " + EVERY_SETTER
)

#: Each engine a rescan meets: whether auto-save is on, the control daemon's State
#: overrides, and whether its whole lane stops answering once the rescan lands.
#: - "held": the engine holds ENGINE_HELD and every setter applies.
#: - "nothing to carry": the engine already sits at the config file's values, so the
#:   rescan brings it back exactly where it was.
#: - "deaf": every setter answers OK and applies nothing (`_deaf`, protocol.md §6),
#:   so the verify readback never agrees.
#: - "raising": the socket goes away underneath each write, so the lane raises
#:   rather than reporting a setting that did not verify.
#: - "never returns": the daemon accepts every connection and drops it again, so
#:   the replay's bounded wait for the control lane runs out.
SCENARIOS: dict[str, tuple[bool, dict[str, str], bool]] = {
    "held": (True, {}, False),
    "autosave off": (False, {}, False),
    "nothing to carry": (True, {"matrix_profile": "", **ENGINE_AFTER_RESCAN}, False),
    "deaf": (True, {"_deaf": EVERY_SETTER}, False),
    "raising": (True, {"_close": EVERY_SETTER}, False),
    "never returns": (True, {}, True),
}


Rescan = Callable[[str], Awaitable[tuple[RescanReport, CommandLog]]]


@pytest.fixture
def rescan_on(
    daemon: DaemonFactory, start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> Rescan:
    """Run one rescan against the named engine; hand back its report and the commands it sent."""

    async def run(scenario: str) -> tuple[RescanReport, CommandLog]:
        autosave, overrides, closes = SCENARIOS[scenario]
        manager, log, state = await _rescanning(
            daemon, start_manager, http_daemon, tmp_path, autosave=autosave, **overrides
        )
        if closes:
            http_daemon["_on_refresh"] = lambda: state.update({"_close": EVERY_COMMAND})
        before = len(log)
        report = await engineread.refresh_devices(manager)
        return report, log[before:]

    return run


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


# --- which live setters the rescan sends --------------------------------------
# Auto-save off is the whole gate: nothing goes back. An engine already at the
# file's values has nothing the user set live to lose, so anything written there
# is a write the rescan had no reason to make.


@pytest.mark.parametrize(
    ("scenario", "setters"),
    [("autosave off", []), ("nothing to carry", []), ("held", HELD_SETTERS)],
)
async def test_a_rescan_sends_live_setters_only_for_settings_auto_save_has_to_carry(
    rescan_on: Rescan, scenario: str, setters: list[tuple[str, str]]
) -> None:
    _report, sent = await rescan_on(scenario)
    assert set(_setters(sent)) == set(setters)


@pytest.mark.parametrize("scenario", ["held", "deaf"])
async def test_a_rescan_that_sends_live_setters_sends_the_mode_first(rescan_on: Rescan, scenario: str) -> None:
    """The mode switch re-enumerates the chain's lists, so a setter sent before it names an index from the old list."""
    _report, sent = await rescan_on(scenario)
    assert [name for name, _ in _setters(sent)][:1] == ["SetMode"]


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


# --- what the replay reports ---------------------------------------------------
# The replay is best-effort: whatever it meets, the rescan itself succeeded. Only
# a setting verified by readback may be reported as put back, and no outcome is
# silent.


@pytest.mark.parametrize(
    ("scenario", "restored"),
    [("nothing to carry", {}), ("deaf", {}), ("raising", {}), ("never returns", {}), ("held", HELD_RESTORED)],
)
async def test_a_rescan_reports_restored_only_the_settings_that_verified(
    rescan_on: Rescan, scenario: str, restored: dict[str, str]
) -> None:
    report, _sent = await rescan_on(scenario)
    assert report.restored == restored


@pytest.mark.parametrize(
    ("scenario", "outcome"),
    [
        ("held", ReplayOutcome.RESTORED),
        ("autosave off", ReplayOutcome.NOTHING_TO_RESTORE),
        ("nothing to carry", ReplayOutcome.NOTHING_TO_RESTORE),
        ("deaf", ReplayOutcome.WRITE_FAILED),
        ("raising", ReplayOutcome.WRITE_FAILED),
        ("never returns", ReplayOutcome.UNREACHABLE),
    ],
)
async def test_a_rescan_names_how_its_replay_came_out(rescan_on: Rescan, scenario: str, outcome: ReplayOutcome) -> None:
    report, _sent = await rescan_on(scenario)
    assert report.replay is outcome


def _control_reachable(client: TestClient) -> bool:
    """The app has connected to the control fake, so a rescan has a live snapshot to take."""
    return bool(client.get("/api/health").json()["reachable"])


@pytest.fixture
def rescan_api(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[Callable[[str], dict[str, Any]]]:
    """POST one rescan over REST against the named engine; hand back the body it answers.

    Torn down in step: the client first, so the app hangs up, then the control fake behind it.
    """
    closing = contextlib.ExitStack()

    def run(scenario: str) -> dict[str, Any]:
        autosave, overrides, _closes = SCENARIOS[scenario]
        state = {**DEFAULTS, **ENGINE_HELD, **overrides}
        daemon = spawn_threaded_daemon(state=state)
        port = next(daemon)
        closing.callback(next, daemon, None)
        if autosave:
            PresetStore(tmp_path / "presets").set_autosave(enabled=True)
        http_daemon["_on_refresh"] = lambda: state.update(ENGINE_AFTER_RESCAN)
        served = fixtures_clients.app(http_daemon, tmp_path, port, None)
        client = next(served)
        closing.callback(next, served, None)
        wait_for_api(client, _control_reachable)
        body: dict[str, Any] = client.post("/api/config/refresh").json()
        return body

    yield run
    closing.close()


@pytest.mark.parametrize(("scenario", "warned"), [("held", False), ("nothing to carry", False), ("deaf", True)])
def test_a_rescan_answers_a_warning_only_when_its_replay_left_the_engine_off(
    rescan_api: Callable[[str], dict[str, Any]], scenario: str, *, warned: bool
) -> None:
    """The page tells the user live settings were lost exactly when the answer carries a warning (store/sync.js)."""
    assert bool(rescan_api(scenario).get("warning")) is warned


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
