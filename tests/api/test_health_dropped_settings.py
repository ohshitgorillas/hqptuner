"""``GET /api/health`` reports the live settings a daemon restart dropped.

hqplayerd keeps a setting changed over the control API in memory only, so a
restart brings it back up on its config file (protocol §1, settings
persistence). A setting HQPTuner wrote live and the engine confirmed, then found
at a different value on the connection made after hqplayerd restarted on its
own, is listed under ``dropped_settings`` as the config-form field, the value
HQPTuner wrote, and the engine's own name for that value. A connection that
dropped and came back to an engine still holding every written setting (a
network blip, or the daemon's idle close) lists nothing.

The control fake starts on the PCM chain with every setting at its first list
entry, which is also what its config file brings back after a restart.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import fake_control
import pytest
from apps import advance_app, app_manager, live_app, settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
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
