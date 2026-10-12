"""``GET /api/health`` leaves out a live setting another client took over.

A live setting HQPTuner wrote and the engine confirmed, which another client
then moved on the engine (HQPlayer's own interface, or a control point such as
Roon), is no longer HQPTuner's to report: it is not listed under
``dropped_settings`` when hqplayerd later restarts on its own and comes back
off it, nor when a reconnect with no restart finds it at the other client's
value. Another client's output-mode switch clears a pinned rate on the engine,
and the pin is then not listed either. A second live setting HQPTuner wrote,
which no other client touched, is listed exactly as it would be alone.

Another client's command moves the control fake's shared State the way the
engine applies that setter, and the app reads the move on its next poll before
the connection ends.
"""

import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import fake_control
import pytest
import test_health_dropped_settings
from apps import advance_app, app_manager, live_app, settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import CommandHooks, CommandLog, OnNextArrival, apply_setter
from narrow import FixtureError
from test_health_dropped_settings import (
    ADAPTIVE_VOLUME_WRITE,
    CONFIG_FILE_STATE,
    FILTER_WRITE,
    HEARTBEATS,
    INTERRUPTIONS,
    JUNK_FILTER_WRITE,
    RATE_PIN_WRITE,
    WRITES,
    Interruption,
    LiveWrite,
    RestartableApp,
)

# Bound by assignment so pytest finds the fixture in this module's namespace.
restartable_app = test_health_dropped_settings.restartable_app

#: The live writes the shared suite makes, by config-form field.
WRITES_BY_FIELD = {write.field: write for write in WRITES}

#: A live setting HQPTuner writes that no other client touches.
KEPT_WRITE = ADAPTIVE_VOLUME_WRITE


class Move(NamedTuple):
    """A live setting HQPTuner writes, and the setter command and list index
    another client then sends to move the engine off it."""

    write: LiveWrite
    command: str
    value: str


#: Each other client's value is a list index on the chain the write left loaded,
#: off the written one, and off the config file's wherever that list has a third
#: entry: mode index 0 is "[source]", PCM filter index 3 "poly-sinc-short-mp",
#: PCM shaper index 0 "none", junk filter index 2 "30k", PCM rate index 1 44100 Hz.
MOVES = {
    "mode": Move(WRITES_BY_FIELD["mode"], "SetMode", "0"),
    "filter": Move(FILTER_WRITE, "SetFilter", "3"),
    "dither": Move(WRITES_BY_FIELD["dither"], "SetShaping", "0"),
    "junk_filter": Move(JUNK_FILTER_WRITE, "SetJunkFilter", "2"),
    "rate": Move(RATE_PIN_WRITE, "SetRate", "1"),
}

#: Another client switches the output mode to SDM, State mode index 2; the
#: engine clears a standing rate pin on a mode write, back to index 0, auto.
OTHER_CLIENT_MODE_SWITCH = ("SetMode", "2")
PIN_CLEARED_INDEX = "0"


def _write_live(app: RestartableApp, write: LiveWrite) -> None:
    """Write ``write`` over the live lane and have the engine confirm it."""
    app.client.post("/api/config/live", json={"fields": {write.field: write.value}})
    if app.state[write.state_key] != write.landed:
        raise FixtureError(reason=f"the engine never took {write.field}={write.value}")


def _sent_by_another_client(app: RestartableApp, command: str, value: str, watched: list[str]) -> None:
    """Another client sends ``command`` with ``value``, the engine applies it,
    and the app reads every ``watched`` State attribute back on its next poll."""
    apply_setter(command, {"value": value}, app.state)
    settle_app(app.client)
    advance_app(app.client, app_manager(app.client).cfg.poll_interval)
    seen = app.client.get("/api/state").json()["data"]
    for key in watched:
        if str(seen.get(key)) != app.state[key]:
            raise FixtureError(reason=f"the app never saw the engine's {key}={app.state[key]}")


def _dropped_after_reconnect(app: RestartableApp) -> object:
    """``dropped_settings`` once the app has made a new connection, read the
    engine's State over it, and run heartbeats over it."""
    served_before = len(app.log)
    wait_for_api(app.client, lambda _c: any(name == "State" for name, _ in app.log[served_before:]))
    settle_app(app.client)
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(HEARTBEATS):
        advance_app(app.client, interval)
    return app.client.get("/api/health").json().get("dropped_settings")


def _dropped_with_engine_off(app: RestartableApp, write: LiveWrite) -> object:
    """``dropped_settings`` once the app has reconnected to an engine that no
    longer holds ``write``."""
    dropped = _dropped_after_reconnect(app)
    if app.state[write.state_key] == write.landed:
        raise FixtureError(reason=f"the engine came back holding {write.field}={write.value}")
    return dropped


def _entry(write: LiveWrite) -> dict[str, str | None]:
    """The ``dropped_settings`` entry for ``write``."""
    return {"field": write.field, "value": write.value, "name": write.name}


def _kept_listed(*, lost: bool) -> list[dict[str, str | None]]:
    """What ``dropped_settings`` holds: the kept write's entry when the engine
    lost it, nothing when the engine still holds it."""
    return [_entry(KEPT_WRITE)] if lost else []


@pytest.mark.parametrize("interruption", INTERRUPTIONS.values(), ids=INTERRUPTIONS.keys())
@pytest.mark.parametrize("move", MOVES.values(), ids=MOVES.keys())
def test_a_live_write_another_client_moved_is_not_listed_when_the_connection_comes_back(
    restartable_app: RestartableApp, move: Move, interruption: Interruption
) -> None:
    _write_live(restartable_app, KEPT_WRITE)
    _write_live(restartable_app, move.write)
    _sent_by_another_client(restartable_app, move.command, move.value, [move.write.state_key])
    interruption.cut(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _kept_listed(lost=interruption.loses_writes)


@pytest.mark.parametrize("interruption", INTERRUPTIONS.values(), ids=INTERRUPTIONS.keys())
def test_a_rate_pin_another_clients_mode_switch_cleared_is_not_listed_when_the_connection_comes_back(
    restartable_app: RestartableApp, interruption: Interruption
) -> None:
    _write_live(restartable_app, RATE_PIN_WRITE)
    _write_live(restartable_app, KEPT_WRITE)
    command, value = OTHER_CLIENT_MODE_SWITCH
    _sent_by_another_client(restartable_app, command, value, ["mode", RATE_PIN_WRITE.state_key])
    if restartable_app.state[RATE_PIN_WRITE.state_key] != PIN_CLEARED_INDEX:
        raise FixtureError(reason="the other client's mode switch left the rate pin standing")
    interruption.cut(restartable_app.state)
    assert _dropped_after_reconnect(restartable_app) == _kept_listed(lost=interruption.loses_writes)


# --- HQPTuner's own write inside a heartbeat that saw the engine change -------

#: The live setting HQPTuner writes around a heartbeat: one whose list and
#: indices stay the same on both chains.
OWN_WRITE = JUNK_FILTER_WRITE

#: The setter that write sends.
OWN_SETTER = "SetJunkFilter"

#: The enumeration queries (architecture 3.1) a heartbeat that has seen the
#: engine change makes again, and the first of them, on whose arrival HQPTuner's
#: own write is sent.
LIST_READS = ("GetModes", "GetFilters", "GetShapers", "GetRates", "GetJunkFilters")
LIST_READ = LIST_READS[0]


@dataclass(frozen=True)
class HookedApp(RestartableApp):
    """``RestartableApp``, plus the control fake's one-shot command hooks."""

    hooks: CommandHooks


@pytest.fixture
def hooked_app(tmp_path: Path) -> Iterator[HookedApp]:
    """The control-only app on one shared State, with hooks the test can set on a command."""
    state = {**fake_control.DEFAULTS, **CONFIG_FILE_STATE}
    log: CommandLog = []
    hooks: CommandHooks = {}
    daemon = spawn_threaded_daemon(state=state, log=log, hooks=hooks)
    app = live_app(next(daemon), tmp_path)
    yield HookedApp(next(app), state, log, hooks)
    next(app, None)
    next(daemon, None)


def _write_on_list_read(app: HookedApp, write: LiveWrite) -> threading.Thread:
    """Have ``write`` sent over the live lane, from a thread of its own, once
    ``LIST_READ`` arrives; the list read is answered without waiting for it."""
    writer = threading.Thread(
        target=lambda: app.client.post("/api/config/live", json={"fields": {write.field: write.value}})
    )
    app.hooks[LIST_READ] = OnNextArrival(writer.start)
    return writer


def _landed_inside_list_reads(served: list[str]) -> bool:
    """Whether ``OWN_SETTER`` arrived before the last list read the heartbeat made."""
    reads = [index for index, name in enumerate(served) if name in LIST_READS]
    return OWN_SETTER in served and bool(reads) and served.index(OWN_SETTER) < reads[-1]


def _dropped_after_write_inside_heartbeat(app: HookedApp) -> object:
    """``dropped_settings`` once ``OWN_WRITE`` has been confirmed while the
    heartbeat that saw another client's mode switch was re-reading the engine's
    lists, heartbeats have run on, and hqplayerd has then restarted on its own."""
    writer = _write_on_list_read(app, OWN_WRITE)
    served_before = len(app.log)
    command, value = OTHER_CLIENT_MODE_SWITCH
    apply_setter(command, {"value": value}, app.state)
    settle_app(app.client)
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(HEARTBEATS):
        advance_app(app.client, interval)
    served = [name for name, _ in app.log[served_before:]]
    if LIST_READ in app.hooks:
        raise FixtureError(reason=f"no {LIST_READ} reached the hook; served {served}")
    writer.join()
    if app.state[OWN_WRITE.state_key] != OWN_WRITE.landed:
        raise FixtureError(reason=f"the engine never took {OWN_WRITE.field}={OWN_WRITE.value}")
    if not _landed_inside_list_reads(served):
        raise FixtureError(reason=f"{OWN_SETTER} did not land among the heartbeat's list reads; served {served}")
    INTERRUPTIONS["restart"].cut(app.state)
    return _dropped_after_reconnect(app)


def test_an_own_write_confirmed_inside_a_heartbeat_that_saw_the_engine_change_is_listed_after_a_restart(
    hooked_app: HookedApp,
) -> None:
    assert _dropped_after_write_inside_heartbeat(hooked_app) == [_entry(OWN_WRITE)]


# --- a source switch in [source] mode -----------------------------------------

#: The config file of an engine in ``[source]`` mode, State mode index 0, every
#: other setting on its first list entry.
SOURCE_CONFIG_STATE = {**CONFIG_FILE_STATE, "mode": "0"}

#: What the control fake reports as the source family: PCM material keeps the
#: PCM chain loaded, DSD material the SDM one.
PCM_SOURCE = "PCM"
DSD_SOURCE = "SDM (DSD)"

#: The PCM-chain writes HQPTuner makes while PCM material plays.
PCM_CHAIN_WRITES = {"filter": FILTER_WRITE, "dither": WRITES_BY_FIELD["dither"]}

#: The State attributes that report the loaded chain's filters and shaper.
CHAIN_STATE_KEYS = ("filter1x", "filterNx", "shaper")


@pytest.fixture
def source_app(tmp_path: Path) -> Iterator[RestartableApp]:
    """The control-only app on one shared State, the engine in ``[source]``
    mode playing PCM material."""
    state = {**fake_control.DEFAULTS, **SOURCE_CONFIG_STATE, "_active_mode": PCM_SOURCE}
    log: CommandLog = []
    daemon = spawn_threaded_daemon(state=state, log=log)
    app = live_app(next(daemon), tmp_path)
    yield RestartableApp(next(app), state, log)
    next(app, None)
    next(daemon, None)


def _source_switched_to_dsd(app: RestartableApp) -> None:
    """The source moves to DSD material: the engine loads the SDM chain, whose
    filters and modulator sit on their first list entries, with State mode left
    at ``[source]``; the app polls the engine over it."""
    app.state["_active_mode"] = DSD_SOURCE
    for key in CHAIN_STATE_KEYS:
        app.state[key] = "0"
    served_before = len(app.log)
    settle_app(app.client)
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(HEARTBEATS):
        advance_app(app.client, interval)
    if not any(name == "Status" for name, _ in app.log[served_before:]):
        raise FixtureError(reason="no heartbeat read Status after the source switch")


def _restart_on_its_own_in_source(state: dict[str, str]) -> None:
    """hqplayerd restarts by itself onto its ``[source]`` config file, PCM
    material playing again, and severs every connection."""
    state.update(SOURCE_CONFIG_STATE)
    state["_active_mode"] = PCM_SOURCE
    state["_generation"] = str(int(state.get("_generation", "0")) + 1)
    state["_refuse_connects"] = "1"


@pytest.mark.parametrize("write", PCM_CHAIN_WRITES.values(), ids=PCM_CHAIN_WRITES.keys())
def test_a_pcm_chain_write_a_source_switch_to_dsd_left_dormant_is_listed_after_a_restart(
    source_app: RestartableApp, write: LiveWrite
) -> None:
    _write_live(source_app, write)
    _source_switched_to_dsd(source_app)
    _restart_on_its_own_in_source(source_app.state)
    assert _dropped_with_engine_off(source_app, write) == [_entry(write)]


# --- refused State reads after a confirmed write ------------------------------


def _state_refused_after_readback(app: HookedApp) -> None:
    """Once ``OWN_SETTER`` arrives, the engine applies and answers it, answers
    the State read that confirms it, and refuses every State read after that."""

    def refuse_state() -> None:
        app.state["_error"] = "State"

    def answer_readback() -> None:
        app.hooks["State"] = OnNextArrival(refuse_state)

    def arm() -> None:
        app.hooks["State"] = OnNextArrival(answer_readback)

    app.hooks[OWN_SETTER] = OnNextArrival(arm)


def _dropped_after_refused_reads(app: HookedApp) -> object:
    """``dropped_settings`` once ``OWN_WRITE`` has been confirmed with the
    follow-up State read refused, a later heartbeat's State read has been
    refused too, and hqplayerd has then restarted on its own."""
    _state_refused_after_readback(app)
    _write_live(app, OWN_WRITE)
    if app.state.get("_error") != "State":
        raise FixtureError(reason=f"no State read after the {OWN_SETTER} readback was refused")
    served_before = len(app.log)
    settle_app(app.client)
    advance_app(app.client, app_manager(app.client).cfg.poll_interval)
    if not any(name == "State" for name, _ in app.log[served_before:]):
        raise FixtureError(reason="no heartbeat read State while the engine refused it")
    INTERRUPTIONS["restart"].cut(app.state)
    app.state.pop("_error")
    return _dropped_with_engine_off(app, OWN_WRITE)


def test_a_write_whose_follow_up_state_read_and_next_heartbeat_were_refused_is_listed_after_a_restart(
    hooked_app: HookedApp,
) -> None:
    assert _dropped_after_refused_reads(hooked_app) == [_entry(OWN_WRITE)]
