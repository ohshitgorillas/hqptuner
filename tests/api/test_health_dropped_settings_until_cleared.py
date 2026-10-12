"""``dropped_settings`` keeps what it lists until the user clears it.

Once a restart hqplayerd made on its own has dropped a live setting HQPTuner
wrote, ``GET /api/health`` goes on listing it through a later live write.
``DELETE /api/health/dropped-settings`` answers 204 and empties the list, and a
restart after the clear lists only what that restart dropped.
"""

from collections.abc import Callable
from typing import NamedTuple

import pytest
import test_health_dropped_settings
from apps import advance_app, app_manager, settle_app, wait_for_api
from narrow import FixtureError
from test_health_dropped_settings import (
    ADAPTIVE_VOLUME_WRITE,
    HEARTBEATS,
    INTERRUPTIONS,
    JUNK_FILTER_WRITE,
    LiveWrite,
    RestartableApp,
)

# Bound by assignment so pytest finds the fixture in this module's namespace.
restartable_app = test_health_dropped_settings.restartable_app

#: The route that clears the list.
CLEAR_ROUTE = "/api/health/dropped-settings"

#: What a successful clear answers.
CLEARED = 204

#: The setting the first restart drops.
FIRST_LOST = JUNK_FILTER_WRITE

#: A second live setting, on another field.
SECOND_LOST = ADAPTIVE_VOLUME_WRITE


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


def _write_another_setting(app: RestartableApp) -> None:
    """A live write of a setting the list does not hold."""
    _write_live(app, SECOND_LOST)


def _write_the_lost_setting_again(app: RestartableApp) -> None:
    """The listed setting written live again at the value it was dropped from."""
    _write_live(app, FIRST_LOST)


LATER_EVENTS: dict[str, Callable[[RestartableApp], None]] = {
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


# --- clearing -----------------------------------------------------------------


def test_clearing_the_dropped_settings_answers_no_content(restartable_app: RestartableApp) -> None:
    _lost_to_a_restart(restartable_app, FIRST_LOST)
    assert _clear(restartable_app) == CLEARED


def _nothing_dropped_since(app: RestartableApp) -> object:
    """The list is cleared and read straight away."""
    _clear(app)
    return _dropped(app)


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
