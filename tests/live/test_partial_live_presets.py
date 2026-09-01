"""Live presets that carry only the settings the user picked.

``PUT /api/livepresets/{name}`` takes an optional body naming the fields the
preset holds; a setting left out of the record is a setting the preset has no
opinion about, so applying it later leaves that setting wherever the engine has
it by then. Same shape as ``test_live_presets``: the app under ``TestClient``
against the threaded fake control daemon, every case driven through the REST
routes, every conclusion read back off the engine's own State or the switch's
own route (docs/testing.md — `result="OK"` is not proof a setter applied).

The engine's rate is moved between saving and applying over the LIVE write lane
(``POST /api/config/live``), which is the same road a listener takes. The fake
daemon's PCM rates list puts 352800 Hz at index 2, and State reports the rate as
a list INDEX (protocol.md §6), so "2" read back is the moved rate still standing.
"""

from fastapi.testclient import TestClient


def test_a_preset_saved_without_rate_leaves_the_engine_at_its_current_rate(live_api: TestClient) -> None:
    live_api.put("/api/livepresets/Warm", json={"fields": ["filter", "filter1x"]})
    live_api.post("/api/config/live", json={"fields": {"rate": "352800"}})
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/state").json()["data"]["rate"] == "4"


def test_a_preset_saved_without_autopilot_leaves_the_switch_where_it_is(live_api: TestClient) -> None:
    live_api.post("/api/autopilot", json={"enabled": True})
    live_api.put("/api/livepresets/Warm", json={"fields": ["filter"]})
    live_api.post("/api/autopilot", json={"enabled": False})
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/autopilot").json()["enabled"] is False
