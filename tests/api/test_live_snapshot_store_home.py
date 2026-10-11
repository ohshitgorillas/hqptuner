"""One live-snapshot store, shared by core and the web app.

A snapshot recorded from core, with no HTTP request, is the same snapshot the
live-preset routes answer for: the routes read the store the manager's preset
collaborator holds rather than one of their own. Driven against the
control-only app, whose manager records on the app's own event loop.
"""

import functools

from apps import NotAVirtualAppError, app_manager
from fastapi.testclient import TestClient

from hqptuner.presets import livesnapshots

#: A matrix profile the fake daemon lists.
LISTED = "Default"


def record_from_core(client: TestClient, name: str) -> None:
    """Record snapshot ``name`` holding ``LISTED`` through core, on the app's loop."""
    portal = client.portal
    if portal is None:
        raise NotAVirtualAppError
    save = functools.partial(
        livesnapshots.record,
        app_manager(client),
        name,
        fields=["matrix_profile"],
        values={"matrix_profile": LISTED},
    )
    portal.call(save)


def listed_names(client: TestClient) -> list[str]:
    """Names of the loaded station's snapshots, as the live-preset route lists them."""
    return sorted(p["name"] for p in client.get("/api/livepresets").json()["presets"])


def test_a_snapshot_recorded_from_core_is_listed_by_the_live_preset_route(live_api: TestClient) -> None:
    record_from_core(live_api, "Warm")
    assert listed_names(live_api) == ["Warm"]
