"""``dropped_settings`` keeps what it lists until the user clears it.

Once a restart hqplayerd made on its own has dropped a live setting HQPTuner
wrote, ``GET /api/health`` goes on listing it through a later reconnect, a
later restart that drops nothing more, a later live write, time passing, and a
restart or reload HQPTuner causes itself. A later restart by hqplayerd that
drops more settings adds them; a setting dropped again shows the newer write's
value. ``DELETE /api/health/dropped-settings`` answers 204 and empties the list,
and a restart after the clear lists only what that restart dropped.
"""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import NamedTuple

import fake_control
import pytest
import test_health_dropped_settings
from apps import advance_app, app_manager, live_app, settle_app, wait_for_api
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from narrow import FixtureError
from test_health_dropped_settings import (
    ADAPTIVE_VOLUME_WRITE,
    CONFIG_FILE_STATE,
    HEARTBEATS,
    INTERRUPTIONS,
    JUNK_FILTER_WRITE,
    RELOADS,
    RESTARTS,
    SETTLE_SECONDS,
    LiveWrite,
    OwnRestartApp,
    Reload,
    RestartableApp,
)

# Bound by assignment so pytest finds the fixtures in this module's namespace.
restartable_app = test_health_dropped_settings.restartable_app
own_restart_app = test_health_dropped_settings.own_restart_app

#: The route that clears the list.
CLEAR_ROUTE = "/api/health/dropped-settings"

#: What a successful clear answers.
CLEARED = 204

#: The setting the first restart drops: one no restore carries onto the config
#: file, so HQPTuner's own restarts leave the engine off it too.
FIRST_LOST = JUNK_FILTER_WRITE

#: A second live setting, on another field.
SECOND_LOST = ADAPTIVE_VOLUME_WRITE

#: The first setting written again at another value: junk filter 2 is "30k".
FIRST_REWRITTEN = LiveWrite("junk_filter", "2", "filter_junk", "2", "30k")

#: Virtual seconds of a day passing, and the heartbeat interval of the app it
#: passes on: an hour, so the day is a few heartbeats rather than thousands.
A_DAY = 86400.0
AN_HOUR = 3600.0


def _entry(write: LiveWrite) -> dict[str, str | None]:
    """The ``dropped_settings`` entry for ``write``."""
    return {"field": write.field, "value": write.value, "name": write.name}


def _write_live(app: RestartableApp, write: LiveWrite) -> None:
    """Write ``write`` over the live lane and have the engine confirm it."""
    app.client.post("/api/config/live", json={"fields": {write.field: write.value}})
    if app.state[write.state_key] != write.landed:
        raise FixtureError(reason=f"the engine never took {write.field}={write.value}")


def _reconnect(app: RestartableApp) -> None:
    """Let the app make a new connection, read State over it, and run heartbeats over it."""
    served_before = len(app.log)
    wait_for_api(app.client, lambda _c: any(name == "State" for name, _ in app.log[served_before:]))
    settle_app(app.client)
    interval = app_manager(app.client).cfg.poll_interval
    for _ in range(HEARTBEATS):
        advance_app(app.client, interval)


def _dropped(app: RestartableApp) -> object:
    """``dropped_settings`` as ``GET /api/health`` reports it now."""
    return app.client.get("/api/health").json().get("dropped_settings")


def _restart_and_reconnect(app: RestartableApp) -> object:
    """hqplayerd restarts on its own; ``dropped_settings`` once the app is back."""
    INTERRUPTIONS["restart"].cut(app.state)
    _reconnect(app)
    return _dropped(app)


def _lost_to_a_restart(app: RestartableApp, write: LiveWrite) -> None:
    """Write ``write``, have hqplayerd restart on its own and drop it, and have
    the app list it alone."""
    _write_live(app, write)
    listed = _restart_and_reconnect(app)
    if listed != [_entry(write)]:
        raise FixtureError(reason=f"the restart did not list {write.field} alone: {listed}")


def _clear(app: RestartableApp) -> int:
    """Clear the list; the status the route answers."""
    status: int = app.client.delete(CLEAR_ROUTE).status_code
    return status


# --- the list stays through later events --------------------------------------


def _reconnect_losing_nothing(app: RestartableApp) -> None:
    """The connection drops and comes back to an engine that lost nothing."""
    INTERRUPTIONS["blip"].cut(app.state)
    _reconnect(app)


def _restart_losing_nothing_more(app: RestartableApp) -> None:
    """hqplayerd restarts on its own again, with no live write since the last."""
    INTERRUPTIONS["restart"].cut(app.state)
    _reconnect(app)


def _write_another_setting(app: RestartableApp) -> None:
    """A live write of a setting the list does not hold."""
    _write_live(app, SECOND_LOST)


def _write_the_lost_setting_again(app: RestartableApp) -> None:
    """The listed setting written live again at the value it was dropped from."""
    _write_live(app, FIRST_LOST)


LATER_EVENTS: dict[str, Callable[[RestartableApp], None]] = {
    "reconnect losing nothing": _reconnect_losing_nothing,
    "restart losing nothing more": _restart_losing_nothing_more,
    "live write of another setting": _write_another_setting,
    "live write of the listed setting": _write_the_lost_setting_again,
}


@pytest.mark.parametrize("event", LATER_EVENTS.values(), ids=LATER_EVENTS.keys())
def test_a_dropped_setting_stays_listed_through_a_later_event_that_drops_nothing(
    restartable_app: RestartableApp, event: Callable[[RestartableApp], None]
) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    event(restartable_app)
    assert _dropped(restartable_app) == [_entry(FIRST_LOST)]


@pytest.fixture
def hourly_app(tmp_path: Path) -> Iterator[RestartableApp]:
    """``restartable_app`` on an app whose heartbeat runs hourly."""
    state = {**fake_control.DEFAULTS, **CONFIG_FILE_STATE}
    log: CommandLog = []
    daemon = spawn_threaded_daemon(state=state, log=log)
    app = live_app(next(daemon), tmp_path, poll_interval=AN_HOUR)
    yield RestartableApp(next(app), state, log)
    next(app, None)
    next(daemon, None)


def test_a_dropped_setting_stays_listed_through_a_day_passing(hourly_app: RestartableApp) -> None:
    _lost_to_a_restart(hourly_app, FIRST_LOST)
    advance_app(hourly_app.client, A_DAY)
    assert _dropped(hourly_app) == [_entry(FIRST_LOST)]


# --- a later restart that drops more ------------------------------------------


def _by_field(dropped: object) -> object:
    """``dropped`` keyed by field, so the comparison ignores list order."""
    if not isinstance(dropped, list):
        return dropped
    return {entry["field"]: entry for entry in dropped}


def test_a_later_restart_that_drops_another_setting_adds_it_to_the_list(
    restartable_app: RestartableApp,
) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    _write_live(restartable_app, SECOND_LOST)
    dropped = _restart_and_reconnect(restartable_app)
    assert _by_field(dropped) == {FIRST_LOST.field: _entry(FIRST_LOST), SECOND_LOST.field: _entry(SECOND_LOST)}


def test_a_setting_dropped_again_is_listed_once_with_the_newer_writes_value(
    restartable_app: RestartableApp,
) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    _write_live(restartable_app, FIRST_REWRITTEN)
    assert _restart_and_reconnect(restartable_app) == [_entry(FIRST_REWRITTEN)]


# --- HQPTuner's own restarts and reloads --------------------------------------


def _own_restart(cause: Callable[[OwnRestartApp], None]) -> Callable[[OwnRestartApp], None]:
    """``cause`` restarts the engine, and the app reconnects to it."""

    def restarted(app: OwnRestartApp) -> None:
        before = len(app.restarts)
        cause(app)
        if len(app.restarts) == before:
            raise FixtureError(reason="the engine never restarted")
        _reconnect(app)

    return restarted


def _own_reload(reload: Reload) -> Callable[[OwnRestartApp], None]:
    """``reload`` moves the engine onto its config file with the connection kept,
    then ``SETTLE_SECONDS`` pass on the app's clock."""

    def reloaded(app: OwnRestartApp) -> None:
        def in_place() -> None:
            app.restarts.append("in place")
            app.state.update(CONFIG_FILE_STATE)

        app.http[reload.hook] = in_place
        before = len(app.restarts)
        reload.cause(app)
        if len(app.restarts) == before:
            raise FixtureError(reason="the request never reloaded the engine")
        interval = app_manager(app.client).cfg.poll_interval
        for _ in range(int(SETTLE_SECONDS / interval) + 1):
            advance_app(app.client, interval)

    return reloaded


#: One own restart, the app reconnecting after it, and one own reload in place,
#: the connection kept through it; each runs after the list is filled.
OWN_CAUSES: dict[str, Callable[[OwnRestartApp], None]] = {
    "settings apply": _own_restart(RESTARTS["settings apply"].cause),
    "speaker apply, reload in place": _own_reload(RELOADS["speaker apply"]),
}


@pytest.mark.parametrize("own", OWN_CAUSES.values(), ids=OWN_CAUSES.keys())
def test_a_dropped_setting_stays_listed_through_a_restart_or_reload_hqptuner_causes(
    own_restart_app: OwnRestartApp, own: Callable[[OwnRestartApp], None]
) -> None:
    _lost_to_a_restart(own_restart_app, FIRST_LOST)
    own(own_restart_app)
    assert _dropped(own_restart_app) == [_entry(FIRST_LOST)]


# --- clearing -----------------------------------------------------------------


def test_clearing_the_dropped_settings_answers_no_content(restartable_app: RestartableApp) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    assert _clear(restartable_app) == CLEARED


def _nothing_dropped_since(app: RestartableApp) -> object:
    """The list is cleared and read straight away."""
    _clear(app)
    return _dropped(app)


def _written_after_the_clear_then_dropped(app: RestartableApp) -> object:
    """The list is cleared, the second setting written, then a restart drops it."""
    _clear(app)
    _write_live(app, SECOND_LOST)
    return _restart_and_reconnect(app)


def _written_before_the_clear_then_dropped(app: RestartableApp) -> object:
    """The second setting is written, the list cleared, then a restart drops it."""
    _write_live(app, SECOND_LOST)
    _clear(app)
    return _restart_and_reconnect(app)


class SinceTheClear(NamedTuple):
    """What happens from the clear on, ending in a read of the list, and what
    the list then holds."""

    happen: Callable[[RestartableApp], object]
    listed: list[dict[str, str | None]]


SINCE_THE_CLEAR = {
    "nothing dropped since": SinceTheClear(_nothing_dropped_since, []),
    "written after the clear, dropped since": SinceTheClear(
        _written_after_the_clear_then_dropped, [_entry(SECOND_LOST)]
    ),
    "written before the clear, dropped since": SinceTheClear(
        _written_before_the_clear_then_dropped, [_entry(SECOND_LOST)]
    ),
}


@pytest.mark.parametrize("since", SINCE_THE_CLEAR.values(), ids=SINCE_THE_CLEAR.keys())
def test_after_a_clear_the_list_holds_only_the_settings_dropped_since(
    restartable_app: RestartableApp, since: SinceTheClear
) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    assert since.happen(restartable_app) == since.listed
