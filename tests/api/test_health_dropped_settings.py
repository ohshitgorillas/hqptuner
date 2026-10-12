"""``GET /api/health`` reports the live settings a daemon restart dropped.

hqplayerd keeps a setting changed over the control API in memory only, so a
restart brings it back up on its config file (protocol §1, settings
persistence). A setting HQPTuner wrote live and the engine confirmed, then found
at a different value on the connection made after hqplayerd restarted on its
own, is listed under ``dropped_settings`` as the config-form field, the value
HQPTuner wrote, and the engine's own name for that value. A connection that
dropped and came back to an engine still holding every written setting (a
network blip, or the daemon's idle close) lists nothing.

A restart or reload HQPTuner causes itself lists nothing, even where a setting
it wrote live before comes back at another value: a Settings apply that goes
through the restarting restore, with the control connection up or already down
as it starts, a preset load, a device rescan, and a speaker apply. The 8088
fake runs the test's callable when its restore, rescan or speaker apply lands,
and that callable restarts the control fake onto its config file.

The control fake starts on the PCM chain with every setting at its first list
entry, which is also what its config file brings back after a restart.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple

import fake_control
import fake_http
import fixtures_clients
import pytest
from apps import advance_app, app_manager, live_app, settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import CommandHooks, CommandLog, take_lane_down
from fastapi.testclient import TestClient
from narrow import FixtureError

#: The State attributes a restart onto the config file brings back, and the
#: values that file holds for them: the PCM chain, every setting on its first
#: list entry.
CONFIG_FILE_STATE = {
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
}

#: How many heartbeat polls run over the new connection before health is read.
HEARTBEATS = 3


class LiveWrite(NamedTuple):
    """One live setting HQPTuner writes: the config-form field and value posted,
    the State attribute and value the engine reports it back as, and the
    engine's own name for that value, None where the engine names none."""

    field: str
    value: str
    state_key: str
    landed: str
    name: str | None


#: Each write moves its State attribute off the config file's value, so a
#: restart onto that file drops it. The fake's enumerations name the values:
#: mode index 2 is "SDM (DSD)", PCM filter enum 25 is "sinc-M" at index 2, PCM
#: shaper enum 5 is "NS9" at index 1, junk filter 1 is "20k". The PCM rate list
#: carries 705600 Hz at index 3; neither the pinned rate nor adaptive volume has
#: an engine name.
JUNK_FILTER_WRITE = LiveWrite("junk_filter", "1", "filter_junk", "1", "20k")
ADAPTIVE_VOLUME_WRITE = LiveWrite("adaptive_volume", "1", "adaptive", "1", None)
FILTER_WRITE = LiveWrite("filter", "25", "filterNx", "2", "sinc-M")
RATE_PIN_WRITE = LiveWrite("rate", "705600", "rate", "3", None)
WRITES = [
    LiveWrite("mode", "sdm", "mode", "2", "SDM (DSD)"),
    FILTER_WRITE,
    LiveWrite("dither", "5", "shaper", "1", "NS9"),
    JUNK_FILTER_WRITE,
    RATE_PIN_WRITE,
    ADAPTIVE_VOLUME_WRITE,
]


class StagedWrite(NamedTuple):
    """A live setting staged in the pending buffer under its setter's bucket,
    then applied, and the live write that apply amounts to."""

    bucket: str
    write: LiveWrite


#: Live settings the stage-then-apply flow sends down the live lane.
STAGED_WRITES = [
    StagedWrite("junk_filter", JUNK_FILTER_WRITE),
    StagedWrite("adaptive_volume", ADAPTIVE_VOLUME_WRITE),
]

#: The 1x filter the engine holds when HQPTuner writes the Nx filter, set there by
#: something other than HQPTuner: list index 1, "poly-sinc-gauss-long", off the
#: config file's index 0. Writing the Nx filter carries it along unchanged.
HELD_1X_STATE_KEY = "filter1x"
HELD_1X_INDEX = "1"

#: A write of the output mode the engine already runs: the PCM chain, State mode
#: index 1. The engine clears a standing rate pin on every mode write, back to
#: index 0, auto.
SAME_MODE_WRITE = LiveWrite("mode", "pcm", "mode", "1", "PCM")
PIN_CLEARED_INDEX = "0"


@dataclass(frozen=True)
class RestartableApp:
    """The app, and the control fake's shared State and command log."""

    client: TestClient
    state: dict[str, str]
    log: CommandLog


@pytest.fixture
def restartable_app(tmp_path: Path) -> Iterator[RestartableApp]:
    """The control-only app connected to a fake on one shared State, so the test
    can sever the connection and move the engine under it."""
    state = {**fake_control.DEFAULTS, **CONFIG_FILE_STATE}
    log: CommandLog = []
    daemon = spawn_threaded_daemon(state=state, log=log)
    app = live_app(next(daemon), tmp_path)
    yield RestartableApp(next(app), state, log)
    next(app, None)
    next(daemon, None)


def _write_live(app: RestartableApp, write: LiveWrite) -> None:
    """Write ``write`` over the live lane and have the engine confirm it."""
    app.client.post("/api/config/live", json={"fields": {write.field: write.value}})
    if app.state[write.state_key] != write.landed:
        raise FixtureError(reason=f"the engine never took {write.field}={write.value}")


def _stage_and_apply(app: RestartableApp, staged: StagedWrite) -> None:
    """Stage ``staged`` in the pending buffer, apply the buffer, and have the
    engine confirm the write."""
    write = staged.write
    app.client.post("/api/config/stage", json={"live": {staged.bucket: {"value": write.value}}})
    app.client.post("/api/config/apply")
    if app.state[write.state_key] != write.landed:
        raise FixtureError(reason=f"the engine never took staged {staged.bucket}={write.value}")


def _held_by_another_client(app: RestartableApp, state_key: str, value: str) -> None:
    """The engine moves ``state_key`` to ``value`` without HQPTuner writing it,
    and the app reads it back on its next poll."""
    app.state[state_key] = value
    settle_app(app.client)
    advance_app(app.client, app_manager(app.client).cfg.poll_interval)
    if str(app.client.get("/api/state").json()["data"].get(state_key)) != value:
        raise FixtureError(reason=f"the app never saw the engine's {state_key}={value}")


def _sever(state: dict[str, str]) -> None:
    """Every open control connection is severed on its next use, unanswered."""
    state["_generation"] = str(int(state.get("_generation", "0")) + 1)


def _restart_on_its_own(state: dict[str, str]) -> None:
    """hqplayerd restarts by itself: every Control API change is gone, the
    engine is back on its config file, every open connection is severed, and the
    first connect inside the restart window is turned away."""
    state.update(CONFIG_FILE_STATE)
    _sever(state)
    state["_refuse_connects"] = "1"


def _reconnect(app: RestartableApp) -> None:
    """Let the app make a new connection, read the engine's State over it, and
    run heartbeats over it."""
    served_before = len(app.log)
    wait_for_api(app.client, lambda _c: any(name == "State" for name, _ in app.log[served_before:]))
    settle_app(app.client)
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(HEARTBEATS):
        advance_app(app.client, interval)


def _dropped_after_reconnect(app: RestartableApp) -> object:
    """``dropped_settings`` once the app has reconnected."""
    _reconnect(app)
    return app.client.get("/api/health").json().get("dropped_settings")


class Interruption(NamedTuple):
    """How the connection ends, and whether the engine it comes back to has lost
    what HQPTuner wrote."""

    cut: Callable[[dict[str, str]], None]
    loses_writes: bool


#: A restart onto the config file loses every write; a network blip or the
#: daemon's idle close loses none.
INTERRUPTIONS = {
    "restart": Interruption(_restart_on_its_own, loses_writes=True),
    "blip": Interruption(_sever, loses_writes=False),
}


def _listed(write: LiveWrite, *, lost: bool) -> list[dict[str, str | None]]:
    """What ``dropped_settings`` holds for ``write``: its entry when the engine
    lost it, nothing when the engine still holds it."""
    return [{"field": write.field, "value": write.value, "name": write.name}] if lost else []


@pytest.mark.parametrize("interruption", INTERRUPTIONS.values(), ids=INTERRUPTIONS.keys())
@pytest.mark.parametrize("write", WRITES, ids=[write.field for write in WRITES])
def test_a_live_write_is_listed_with_the_value_written_and_the_engines_name_only_when_the_engine_lost_it(
    restartable_app: RestartableApp, write: LiveWrite, interruption: Interruption
) -> None:
    _write_live(restartable_app, write)
    interruption.cut(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _listed(write, lost=interruption.loses_writes)


@pytest.mark.parametrize("staged", STAGED_WRITES, ids=[staged.write.field for staged in STAGED_WRITES])
def test_a_staged_setting_applied_live_that_a_restart_dropped_is_listed_like_a_direct_write(
    restartable_app: RestartableApp, staged: StagedWrite
) -> None:
    _stage_and_apply(restartable_app, staged)
    _restart_on_its_own(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _listed(staged.write, lost=True)


def test_a_setting_a_write_carried_along_unchanged_is_not_listed_when_a_restart_changes_it(
    restartable_app: RestartableApp,
) -> None:
    _held_by_another_client(restartable_app, HELD_1X_STATE_KEY, HELD_1X_INDEX)
    _write_live(restartable_app, FILTER_WRITE)
    if restartable_app.state[HELD_1X_STATE_KEY] != HELD_1X_INDEX:
        raise FixtureError(reason="the Nx filter write moved the 1x filter instead of carrying it along")
    _restart_on_its_own(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _listed(FILTER_WRITE, lost=True)


@pytest.mark.parametrize("write", WRITES, ids=[write.field for write in WRITES])
def test_a_write_kept_through_a_reconnect_that_lost_nothing_is_listed_when_a_later_restart_drops_it(
    restartable_app: RestartableApp, write: LiveWrite
) -> None:
    _write_live(restartable_app, write)
    _sever(restartable_app.state)
    _reconnect(restartable_app)
    _restart_on_its_own(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _listed(write, lost=True)


@pytest.mark.parametrize("interruption", INTERRUPTIONS.values(), ids=INTERRUPTIONS.keys())
def test_a_rate_pin_a_later_mode_write_cleared_is_not_listed_after_a_reconnect(
    restartable_app: RestartableApp, interruption: Interruption
) -> None:
    _write_live(restartable_app, RATE_PIN_WRITE)
    _write_live(restartable_app, ADAPTIVE_VOLUME_WRITE)
    _write_live(restartable_app, SAME_MODE_WRITE)
    if restartable_app.state[RATE_PIN_WRITE.state_key] != PIN_CLEARED_INDEX:
        raise FixtureError(reason="the mode write left the rate pin standing")
    interruption.cut(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _listed(ADAPTIVE_VOLUME_WRITE, lost=interruption.loses_writes)


# --- restarts and reloads HQPTuner causes itself ------------------------------

#: The 8088 fake's config file, agreeing with CONFIG_FILE_STATE: the PCM chain,
#: filter and dither on enum 0, which is list index 0 on the fake's PCM lists.
CONFIG_FILE_FIELDS = {"mode": "pcm", "filter": "0", "filter1x": "0", "dither": "0"}

#: A staged edit with no live route: applying it sends the batch down the
#: restarting restore.
RESTART_EDIT = {"title": "Renamed"}

#: The config preset a preset load switches to, saved before any live write.
PRESET = "Bench"

#: A speaker apply: processing on, the first channel's level moved.
SPEAKER_APPLY = {"enabled": True, "channels": {"0": {"level": "-3"}}}

#: Live writes no restore can carry onto the config file: the junk filter has no
#: config field, and the file's fixed rate slot stays on auto. So the engine a
#: restart brings back is always off what was written.
UNCARRIED_WRITES = [JUNK_FILTER_WRITE, RATE_PIN_WRITE]


@dataclass(frozen=True)
class OwnRestartApp(RestartableApp):
    """The app on both lanes: the control fake as in ``RestartableApp``, the 8088
    fake's state, and one entry per restart the 8088 fake set off on the control
    fake."""

    http: dict[str, Any]
    restarts: list[str]
    control_hooks: CommandHooks


def _config_loaded(client: TestClient) -> bool:
    """Both lanes are up: the control lane connected and the config file read."""
    health = client.get("/api/health").json()
    config = client.get("/api/config")
    return bool(health["reachable"]) and config.status_code == 200 and "title" in config.json()["data"]["file"]


@pytest.fixture
def own_restart_app(tmp_path: Path) -> Iterator[OwnRestartApp]:
    """The app on the control fake and the 8088 fake, where a restore or a rescan
    landing on the 8088 fake restarts the control fake onto its config file."""
    state = {**fake_control.DEFAULTS, **CONFIG_FILE_STATE}
    log: CommandLog = []
    hooks: CommandHooks = {}
    daemon = spawn_threaded_daemon(state=state, log=log, hooks=hooks)
    port = next(daemon)
    server = fake_http.spawn(fake_http.state(**CONFIG_FILE_FIELDS))
    http = next(server)
    served = fixtures_clients.app(http, tmp_path, port, None)
    client = next(served)
    wait_for_api(client, _config_loaded)
    restarts: list[str] = []

    def restart(cause: str) -> Callable[[], None]:
        def restarted() -> None:
            restarts.append(cause)
            state.pop("_down", None)
            _restart_on_its_own(state)

        return restarted

    http["_on_restore"] = restart("restore")
    http["_on_refresh"] = restart("rescan")
    http["_on_speakers"] = restart("speakers")
    yield OwnRestartApp(client, state, log, http, restarts, hooks)
    next(served, None)
    next(server, None)
    next(daemon, None)


def _nothing(_app: OwnRestartApp) -> None:
    """No preparation."""


def _save_preset(app: OwnRestartApp) -> None:
    """Save the running config as ``PRESET``."""
    app.client.post("/api/config/apply", json={"switch_to": "", "save": {"name": PRESET}})


def _apply_through_restore(app: OwnRestartApp) -> None:
    """Stage a setting with no live route and apply it from Settings."""
    app.client.post("/api/config/stage", json={"http": RESTART_EDIT})
    app.client.post("/api/config/apply")


def _apply_through_restore_with_control_down(app: OwnRestartApp) -> None:
    """Lose the control lane, and apply from Settings before the app has noticed."""
    take_lane_down(app.state)
    _apply_through_restore(app)


def _load_preset(app: OwnRestartApp) -> None:
    """Load ``PRESET``."""
    app.client.post("/api/config/apply", json={"switch_to": PRESET})


def _rescan(app: OwnRestartApp) -> None:
    """Rescan the output devices."""
    app.client.post("/api/config/refresh")


def _apply_speakers(app: OwnRestartApp) -> None:
    """Apply a speaker level."""
    app.client.post("/api/speakers", json=SPEAKER_APPLY)


def _restart_by_itself(app: OwnRestartApp) -> None:
    """hqplayerd restarts onto its config file with no request from HQPTuner."""
    app.restarts.append("itself")
    _restart_on_its_own(app.state)


class Restart(NamedTuple):
    """What the case sets up before the live write, what restarts or reloads the
    engine, and whether a write that restart changed is listed."""

    prepare: Callable[[OwnRestartApp], None]
    cause: Callable[[OwnRestartApp], None]
    listed: bool


#: HQPTuner's own restarts and reloads list nothing; the same restart made by
#: hqplayerd on its own lists the write.
RESTARTS = {
    "settings apply": Restart(_nothing, _apply_through_restore, listed=False),
    "settings apply, control down": Restart(_nothing, _apply_through_restore_with_control_down, listed=False),
    "preset load": Restart(_save_preset, _load_preset, listed=False),
    "rescan": Restart(_nothing, _rescan, listed=False),
    "speaker apply": Restart(_nothing, _apply_speakers, listed=False),
    "hqplayerd on its own": Restart(_nothing, _restart_by_itself, listed=True),
}


def _dropped_after_restart(app: OwnRestartApp, restart: Restart, write: LiveWrite) -> object:
    """``dropped_settings`` once ``restart`` has restarted the engine off
    ``write`` and the app has reconnected to it."""
    before = len(app.restarts)
    restart.cause(app)
    if len(app.restarts) == before:
        raise FixtureError(reason="the engine never restarted")
    _reconnect(app)
    if app.state[write.state_key] == write.landed:
        raise FixtureError(reason=f"the engine came back still holding {write.field}={write.value}")
    return app.client.get("/api/health").json().get("dropped_settings")


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("restart", RESTARTS.values(), ids=RESTARTS.keys())
def test_a_live_write_a_restart_changed_is_listed_only_when_hqptuner_did_not_cause_the_restart(
    own_restart_app: OwnRestartApp, restart: Restart, write: LiveWrite
) -> None:
    restart.prepare(own_restart_app)
    _write_live(own_restart_app, write)
    assert _dropped_after_restart(own_restart_app, restart, write) == _listed(write, lost=restart.listed)


# --- an own restart request that never reached the engine ---------------------

#: A speaker apply with a level outside the daemon's range: refused before it is sent.
SPEAKER_OUT_OF_RANGE = {"enabled": True, "channels": {"0": {"level": "999"}}}

#: The settings archive a restore reads before it writes anything.
BACKUP_PATH = "/backup/settings.zip"


def _apply_speakers_out_of_range(app: OwnRestartApp) -> None:
    """Apply a speaker level the range check refuses."""
    app.client.post("/api/speakers", json=SPEAKER_OUT_OF_RANGE)


def _apply_through_restore_with_backup_unreadable(app: OwnRestartApp) -> None:
    """Apply from Settings while the 8088 lane refuses the settings archive, then serve it again."""
    app.http["_fail_paths"] = [BACKUP_PATH]
    _apply_through_restore(app)
    app.http["_fail_paths"] = []


def _rescan_with_config_lane_down(app: OwnRestartApp) -> None:
    """Rescan the output devices with the 8088 lane gone."""
    app.http["_take_lane_down"]()
    _rescan(app)


#: Own restart and reload requests that are refused or fail before reaching the engine.
UNSENT_RESTARTS = {
    "speaker apply out of range": _apply_speakers_out_of_range,
    "settings apply, backup unreadable": _apply_through_restore_with_backup_unreadable,
    "rescan, config lane down": _rescan_with_config_lane_down,
}


def _dropped_after_unsent_then_restart(
    app: OwnRestartApp, unsent: Callable[[OwnRestartApp], None], write: LiveWrite
) -> object:
    """``dropped_settings`` once ``unsent`` has failed to restart the engine,
    hqplayerd has then restarted on its own, and the app has reconnected."""
    before = len(app.restarts)
    unsent(app)
    if len(app.restarts) != before:
        raise FixtureError(reason="the request restarted the engine")
    return _dropped_after_restart(app, RESTARTS["hqplayerd on its own"], write)


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("unsent", UNSENT_RESTARTS.values(), ids=UNSENT_RESTARTS.keys())
def test_a_live_write_is_listed_when_hqplayerd_restarts_after_an_own_restart_request_that_never_reached_it(
    own_restart_app: OwnRestartApp, unsent: Callable[[OwnRestartApp], None], write: LiveWrite
) -> None:
    _write_live(own_restart_app, write)
    assert _dropped_after_unsent_then_restart(own_restart_app, unsent, write) == _listed(write, lost=True)


# --- a live write confirmed while an own restart is under way -----------------


class WriteDuring(NamedTuple):
    """What the case sets up first, the 8088 hook whose restart the live write
    lands inside (None: the write lands before the restart), what restarts the
    engine, and whether the write is listed."""

    prepare: Callable[[OwnRestartApp], None]
    hook: str | None
    cause: Callable[[OwnRestartApp], None]
    listed: bool


#: A write the engine confirms after HQPTuner's own restart request reached the
#: daemon and before the restart lands is lost to that restart: not listed. The
#: same write ahead of a restart hqplayerd makes on its own is.
WRITES_DURING = {
    "settings apply": WriteDuring(_nothing, "_on_restore", _apply_through_restore, listed=False),
    "preset load": WriteDuring(_save_preset, "_on_restore", _load_preset, listed=False),
    "rescan": WriteDuring(_nothing, "_on_refresh", _rescan, listed=False),
    "speaker apply": WriteDuring(_nothing, "_on_speakers", _apply_speakers, listed=False),
    "hqplayerd on its own": WriteDuring(_nothing, None, _restart_by_itself, listed=True),
}


def _write_inside(app: OwnRestartApp, hook: str, write: LiveWrite) -> list[bool]:
    """Have the restart ``hook`` runs first make ``write`` over the live lane,
    and record whether the engine took it before the restart landed."""
    confirmed: list[bool] = []
    restarted = app.http[hook]

    def write_then_restart() -> None:
        app.client.post("/api/config/live", json={"fields": {write.field: write.value}})
        confirmed.append(app.state[write.state_key] == write.landed)
        restarted()

    app.http[hook] = write_then_restart
    return confirmed


def _dropped_after_write_during(app: OwnRestartApp, during: WriteDuring, write: LiveWrite) -> object:
    """``dropped_settings`` once ``write`` has landed inside or ahead of the
    restart ``during`` names and the app has reconnected."""
    if during.hook is None:
        _write_live(app, write)
        return _dropped_after_restart(app, Restart(_nothing, during.cause, during.listed), write)
    confirmed = _write_inside(app, during.hook, write)
    dropped = _dropped_after_restart(app, Restart(_nothing, during.cause, during.listed), write)
    if confirmed != [True]:
        raise FixtureError(reason=f"the engine never took {write.field}={write.value} inside the restart")
    return dropped


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("during", WRITES_DURING.values(), ids=WRITES_DURING.keys())
def test_a_live_write_confirmed_while_a_restart_is_under_way_is_listed_only_when_hqptuner_did_not_cause_it(
    own_restart_app: OwnRestartApp, during: WriteDuring, write: LiveWrite
) -> None:
    during.prepare(own_restart_app)
    assert _dropped_after_write_during(own_restart_app, during, write) == _listed(write, lost=during.listed)


# --- an own reload the engine takes in place ----------------------------------

#: Virtual seconds the app is given after an in-place reload before the case
#: goes on: past the longest restart the protocol documents (a full service
#: restart, about 9.3 s), so any window HQPTuner holds open for it has closed.
SETTLE_SECONDS = 30.0


class Reload(NamedTuple):
    """The 8088 hook a reload lands on, and the request that sets it off."""

    hook: str
    cause: Callable[[OwnRestartApp], None]


RELOADS = {
    "speaker apply": Reload("_on_speakers", _apply_speakers),
    "rescan": Reload("_on_refresh", _rescan),
}


def _reload_in_place(app: OwnRestartApp, reload: Reload) -> None:
    """Have ``reload`` move the engine back onto its config file with the control
    connection kept, then let ``SETTLE_SECONDS`` pass on the app's clock."""

    def reloaded() -> None:
        app.restarts.append("in place")
        app.state.update(CONFIG_FILE_STATE)

    app.http[reload.hook] = reloaded
    before = len(app.restarts)
    reload.cause(app)
    if len(app.restarts) == before:
        raise FixtureError(reason="the request never reloaded the engine")
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(int(SETTLE_SECONDS / interval) + 1):
        advance_app(app.client, interval)


class AroundReload(NamedTuple):
    """Whether the live write lands after the in-place reload or before it, whether
    hqplayerd later restarts on its own, and whether the write is listed."""

    after: bool
    restarted_later: bool
    listed: bool


#: A write the reload itself put back is HQPTuner's own loss, read straight away
#: or at a later restart; a write confirmed after the reload is lost to that
#: later restart.
AROUND_RELOAD = {
    "written after, later restart": AroundReload(after=True, restarted_later=True, listed=True),
    "written before, read then": AroundReload(after=False, restarted_later=False, listed=False),
    "written before, later restart": AroundReload(after=False, restarted_later=True, listed=False),
}


def _dropped_around_reload(app: OwnRestartApp, reload: Reload, around: AroundReload, write: LiveWrite) -> object:
    """``dropped_settings`` for ``write`` made around an in-place ``reload``."""
    if not around.after:
        _write_live(app, write)
    _reload_in_place(app, reload)
    if around.after:
        _write_live(app, write)
    elif app.state[write.state_key] == write.landed:
        raise FixtureError(reason=f"the reload left {write.field}={write.value} standing")
    if around.restarted_later:
        return _dropped_after_restart(app, RESTARTS["hqplayerd on its own"], write)
    return app.client.get("/api/health").json().get("dropped_settings")


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("around", AROUND_RELOAD.values(), ids=AROUND_RELOAD.keys())
@pytest.mark.parametrize("reload", RELOADS.values(), ids=RELOADS.keys())
def test_an_own_reload_in_place_lists_only_the_live_writes_confirmed_after_it(
    own_restart_app: OwnRestartApp, reload: Reload, around: AroundReload, write: LiveWrite
) -> None:
    assert _dropped_around_reload(own_restart_app, reload, around, write) == _listed(write, lost=around.listed)


# --- a reconnect the daemon answers before the own restore restarts it ------

#: The command whose arrival over the reconnect sets off the restart: by then
#: the not-yet-restarted daemon has answered the connect and its State.
ANSWERED_BEFORE_RESTART = "GetModes"


def _lose_control_until_noticed(app: OwnRestartApp) -> None:
    """Take the control lane down and wait until the app reports it gone."""
    take_lane_down(app.state)
    wait_for_api(app.client, lambda c: not c.get("/api/health").json()["connected"])


def _answer_a_reconnect_then_restart(app: OwnRestartApp) -> None:
    """Bring the control lane back on the engine as it stands, and restart it
    once the app's reconnect has been answered."""
    app.control_hooks[ANSWERED_BEFORE_RESTART] = lambda: _restart_by_itself(app)
    app.state.pop("_down", None)
    wait_for_api(app.client, lambda _c: ANSWERED_BEFORE_RESTART not in app.control_hooks)


def _own_restore_then_answered_reconnect(app: OwnRestartApp) -> None:
    """With the control lane down, apply from Settings; the restore lands and
    returns, the daemon answers the app's reconnect, then restarts."""
    _lose_control_until_noticed(app)
    landed: list[bool] = []
    app.http["_on_restore"] = lambda: landed.append(True)
    _apply_through_restore(app)
    if not landed:
        raise FixtureError(reason="the restore never reached the daemon")
    _answer_a_reconnect_then_restart(app)


def _answered_reconnect_then_restart_by_itself(app: OwnRestartApp) -> None:
    """With the control lane down, the daemon answers the app's reconnect, then restarts on its own."""
    _lose_control_until_noticed(app)
    _answer_a_reconnect_then_restart(app)


#: The reconnect the daemon answers after the own restore returned does not make
#: the restart that follows anyone else's; the same reconnect ahead of a restart
#: hqplayerd makes on its own does.
ANSWERED_RECONNECTS = {
    "own restore": Restart(_nothing, _own_restore_then_answered_reconnect, listed=False),
    "hqplayerd on its own": Restart(_nothing, _answered_reconnect_then_restart_by_itself, listed=True),
}


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("restart", ANSWERED_RECONNECTS.values(), ids=ANSWERED_RECONNECTS.keys())
def test_a_reconnect_the_daemon_answers_before_an_own_restore_restarts_it_leaves_the_restart_its_own(
    own_restart_app: OwnRestartApp, restart: Restart, write: LiveWrite
) -> None:
    _write_live(own_restart_app, write)
    assert _dropped_after_restart(own_restart_app, restart, write) == _listed(write, lost=restart.listed)


# --- a live write on the connection after an own restore ----------------------

#: Own restores, each with what it needs set up first.
OWN_RESTORES = {
    "settings apply": Restart(_nothing, _apply_through_restore, listed=True),
    "preset load": Restart(_save_preset, _load_preset, listed=True),
}


def _dropped_after_own_then_restart(app: OwnRestartApp, restore: Restart, write: LiveWrite) -> object:
    """``dropped_settings`` once ``restore`` has restarted the engine, ``write``
    has landed on the new connection, and hqplayerd has then restarted on its own."""
    restore.prepare(app)
    before = len(app.restarts)
    restore.cause(app)
    if len(app.restarts) == before:
        raise FixtureError(reason="the request never restarted the engine")
    _reconnect(app)
    _write_live(app, write)
    return _dropped_after_restart(app, RESTARTS["hqplayerd on its own"], write)


@pytest.mark.parametrize("write", UNCARRIED_WRITES, ids=[write.field for write in UNCARRIED_WRITES])
@pytest.mark.parametrize("restore", OWN_RESTORES.values(), ids=OWN_RESTORES.keys())
def test_a_live_write_on_the_connection_after_an_own_restore_is_listed_when_hqplayerd_restarts_on_its_own(
    own_restart_app: OwnRestartApp, restore: Restart, write: LiveWrite
) -> None:
    assert _dropped_after_own_then_restart(own_restart_app, restore, write) == _listed(write, lost=restore.listed)
