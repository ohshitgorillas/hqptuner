"""Live snapshots that carry only the settings the user picked.

``PUT /api/livepresets/{name}`` takes an optional body naming the fields the
preset holds; a setting left out of the record is a setting the preset has no
opinion about, so applying it later leaves that setting wherever the engine has
it by then. Same shape as ``test_live_presets``: the app under ``TestClient``
against the threaded fake control daemon, every case driven through the REST
routes, every conclusion read back off the engine's own State or the switch's
own route (docs/testing.md — `result="OK"` is not proof a setter applied).
"""

import pytest
from fastapi.testclient import TestClient

#: A preset saved with autopilot on, then applied after the switch was turned
#: off: one that left the switch out leaves it off, one that holds it restores it.
AUTOPILOT_RECORDS = [
    pytest.param(["filter"], False, id="saved-without-autopilot"),
    pytest.param(["filter", "autopilot"], True, id="saved-with-autopilot"),
]


@pytest.mark.parametrize(("fields", "enabled"), AUTOPILOT_RECORDS)
def test_a_preset_restores_the_autopilot_switch_only_when_saved_with_it(
    live_api: TestClient, fields: list[str], *, enabled: bool
) -> None:
    live_api.post("/api/autopilot", json={"enabled": True})
    live_api.put("/api/livepresets/Warm", json={"fields": fields})
    live_api.post("/api/autopilot", json={"enabled": False})
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/autopilot").json()["enabled"] is enabled
