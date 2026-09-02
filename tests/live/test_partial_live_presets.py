"""Live snapshots that carry only the settings the user picked.

``PUT /api/livepresets/{name}`` takes an optional body naming the fields the
preset holds; a setting left out of the record is a setting the preset has no
opinion about, so applying it later leaves that setting wherever the engine has
it by then. Same shape as ``test_live_presets``: the app under ``TestClient``
against the threaded fake control daemon, every case driven through the REST
routes, every conclusion read back off the engine's own State or the switch's
own route (docs/testing.md — `result="OK"` is not proof a setter applied).
"""

from fastapi.testclient import TestClient


def test_a_preset_saved_without_autopilot_leaves_the_switch_where_it_is(live_api: TestClient) -> None:
    live_api.post("/api/autopilot", json={"enabled": True})
    live_api.put("/api/livepresets/Warm", json={"fields": ["filter"]})
    live_api.post("/api/autopilot", json={"enabled": False})
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/autopilot").json()["enabled"] is False
