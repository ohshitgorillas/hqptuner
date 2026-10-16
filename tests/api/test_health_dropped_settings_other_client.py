"""``GET /api/health`` lists a live write confirmed around another client's change.

A live setting HQPTuner wrote and the engine confirmed while the heartbeat that
saw another client's output-mode switch was re-reading the engine's lists, with
the follow-up State read after it refused, is listed under ``dropped_settings``
once hqplayerd restarts on its own. So is one whose follow-up State read, and
the next heartbeat's, the engine refused.

Another client's command moves the control fake's shared State the way the
engine applies that setter.
"""

import asyncio
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import fake_control
import pytest
from apps import advance_app, app_manager, live_app, settle_app
from conftest import spawn_threaded_daemon
from fake_control import CommandHooks, CommandLog, OnNextArrival, apply_setter
from narrow import FixtureError
from test_health_dropped_settings import (
    CONFIG_FILE_STATE,
    JUNK_FILTER_WRITE,
    METERING_OFF,
    LiveWrite,
    RestartableApp,
    dropped_after_reconnect,
    listed,
    restart_on_its_own,
    run_heartbeats,
    write_live,
)

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.lane import LiveApplyReport, apply_now

#: Another client switches the output mode to SDM, State mode index 2.
OTHER_CLIENT_MODE_SWITCH = ("SetMode", "2")


def _dropped_with_engine_off(app: RestartableApp, write: LiveWrite) -> object:
    """``dropped_settings`` once the app has reconnected to an engine that no
    longer holds ``write``."""
    dropped = dropped_after_reconnect(app)
    if app.state[write.state_key] == write.landed:
        raise FixtureError(reason=f"the engine came back holding {write.field}={write.value}")
    return dropped


# --- HQPTuner's own write inside a heartbeat that saw the engine change -------

#: The live setting HQPTuner writes around a heartbeat: one whose list and
#: indices stay the same on both chains.
OWN_WRITE = JUNK_FILTER_WRITE

#: The setter that write sends.
OWN_SETTER = "SetJunkFilter"

#: The enumeration queries a heartbeat that has seen the
#: engine change makes again, and the first of them, on whose arrival HQPTuner's
#: own write is sent.
LIST_READS = ("GetModes", "GetFilters", "GetShapers", "GetRates", "GetJunkFilters")
LIST_READ = LIST_READS[0]


@dataclass(frozen=True)
class HookedApp(RestartableApp):
    """``RestartableApp``, plus the control fake's one-shot command hooks."""

    hooks: CommandHooks


@pytest.fixture
def hooked_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[HookedApp]:
    """The control-only app on one shared State, with hooks the test can set on a command."""
    monkeypatch.setenv(*METERING_OFF)
    state = {**fake_control.DEFAULTS, **CONFIG_FILE_STATE}
    log: CommandLog = []
    hooks: CommandHooks = {}
    daemon = spawn_threaded_daemon(state=state, log=log, hooks=hooks)
    app = live_app(next(daemon), tmp_path)
    yield HookedApp(next(app), state, log, hooks)
    next(app, None)
    next(daemon, None)


async def _queued(manager: ConnectionManager, write: LiveWrite) -> asyncio.Task[LiveApplyReport]:
    """Start ``write`` on the live lane on the app's own loop, and return once it
    waits its turn on the control connection.

    The write runs without pause up to the connection, which the heartbeat holds
    for the command in flight, so one yield leaves it queued there. The
    connection serves its waiters in arrival order: the write goes out next.
    """
    write_task = asyncio.create_task(apply_now(manager, {write.field: write.value}))
    await asyncio.sleep(0)
    return write_task


async def _joined(write_task: asyncio.Task[LiveApplyReport]) -> LiveApplyReport:
    """The report of a write ``_queued`` started."""
    return await write_task


def _write_on_list_read(app: HookedApp, write: LiveWrite) -> list[asyncio.Task[LiveApplyReport]]:
    """Have ``write`` sent over the live lane once ``LIST_READ`` arrives, queued
    on the control connection before that list read is answered; the returned
    list holds the write once it has started."""
    portal = app.client.portal
    if portal is None:
        raise FixtureError(reason="the app's client is not open")
    manager = app_manager(app.client)
    started: list[asyncio.Task[LiveApplyReport]] = []
    app.hooks[LIST_READ] = OnNextArrival(lambda: started.append(portal.call(_queued, manager, write)))
    return started


def _follow_up_read_refused_once(app: HookedApp) -> list[str]:
    """Once ``OWN_SETTER`` arrives, the engine applies and answers it, answers
    the State read that confirms it, refuses the State read after that, and
    answers every State read from then on; the returned list holds that one
    refused read once it is refused."""
    refused: list[str] = []

    def answer_again() -> None:
        app.state.pop("_error")

    def refuse_once() -> None:
        app.state["_error"] = "State"
        refused.append("State")
        app.hooks["State"] = OnNextArrival(answer_again)

    def answer_readback() -> None:
        app.hooks["State"] = OnNextArrival(refuse_once)

    def arm() -> None:
        app.hooks["State"] = OnNextArrival(answer_readback)

    app.hooks[OWN_SETTER] = OnNextArrival(arm)
    return refused


def _landed_inside_list_reads(served: list[str]) -> bool:
    """Whether ``OWN_SETTER`` arrived before the last list read the heartbeat made."""
    reads = [index for index, name in enumerate(served) if name in LIST_READS]
    return OWN_SETTER in served and bool(reads) and served.index(OWN_SETTER) < reads[-1]


def _dropped_after_write_inside_heartbeat(app: HookedApp) -> object:
    """``dropped_settings`` once ``OWN_WRITE`` has been confirmed while the
    heartbeat that saw another client's mode switch was re-reading the engine's
    lists, with the follow-up State read that would bring the heartbeat's
    reading up to it refused, heartbeats have run on, and hqplayerd has then
    restarted on its own."""
    started = _write_on_list_read(app, OWN_WRITE)
    refused = _follow_up_read_refused_once(app)
    served_before = len(app.log)
    command, value = OTHER_CLIENT_MODE_SWITCH
    apply_setter(command, {"value": value}, app.state)
    run_heartbeats(app)
    served = [name for name, _ in app.log[served_before:]]
    if not started:
        raise FixtureError(reason=f"no {LIST_READ} reached the hook; served {served}")
    if app.client.portal is None:
        raise FixtureError(reason="the app's client closed under the heartbeats")
    app.client.portal.call(_joined, started[0])
    if app.state[OWN_WRITE.state_key] != OWN_WRITE.landed:
        raise FixtureError(reason=f"the engine never took {OWN_WRITE.field}={OWN_WRITE.value}")
    if not _landed_inside_list_reads(served):
        raise FixtureError(reason=f"{OWN_SETTER} did not land among the heartbeat's list reads; served {served}")
    if not refused:
        raise FixtureError(reason=f"no State read after the {OWN_SETTER} readback was refused; served {served}")
    restart_on_its_own(app.state)
    return dropped_after_reconnect(app)


def test_an_own_write_confirmed_inside_a_heartbeat_that_saw_the_engine_change_is_listed_after_a_restart(
    hooked_app: HookedApp,
) -> None:
    assert _dropped_after_write_inside_heartbeat(hooked_app) == listed(OWN_WRITE, lost=True)


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
    write_live(app, OWN_WRITE)
    if app.state.get("_error") != "State":
        raise FixtureError(reason=f"no State read after the {OWN_SETTER} readback was refused")
    served_before = len(app.log)
    settle_app(app.client)
    advance_app(app.client, app_manager(app.client).cfg.poll_interval)
    if not any(name == "State" for name, _ in app.log[served_before:]):
        raise FixtureError(reason="no heartbeat read State while the engine refused it")
    restart_on_its_own(app.state)
    app.state.pop("_error")
    return _dropped_with_engine_off(app, OWN_WRITE)


def test_a_write_whose_follow_up_state_read_and_next_heartbeat_were_refused_is_listed_after_a_restart(
    hooked_app: HookedApp,
) -> None:
    assert _dropped_after_refused_reads(hooked_app) == listed(OWN_WRITE, lost=True)
