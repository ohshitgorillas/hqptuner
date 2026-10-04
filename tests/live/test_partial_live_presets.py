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


@pytest.mark.parametrize("enabled", [True, False])
def test_applying_a_preset_leaves_the_autopilot_switch_where_the_user_put_it(
    live_api: TestClient, *, enabled: bool
) -> None:
    # Saved with the switch on, then the switch set before the apply: no
    # snapshot holds auto-pilot, so the apply has nothing to put back.
    live_api.post("/api/autopilot", json={"enabled": True})
    live_api.put("/api/livepresets/Warm")
    live_api.post("/api/autopilot", json={"enabled": enabled})
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/autopilot").json()["enabled"] is enabled


#: What a save naming these settings stores: a chain setting brings the output
#: mode with it, since its ID indexes one chain's list; a chain-free one does not.
PARTIAL_SAVES = [
    pytest.param(["filter"], {"filter", "mode"}, id="chain-setting-brings-mode"),
    pytest.param(["adaptive_volume"], {"adaptive_volume"}, id="chain-free-setting-alone"),
]


@pytest.mark.parametrize(("named", "stored"), PARTIAL_SAVES)
def test_a_partial_save_stores_the_named_settings_and_the_mode_a_chain_setting_needs(
    live_api: TestClient, named: list[str], stored: set[str]
) -> None:
    assert set(live_api.put("/api/livepresets/Warm", json={"fields": named}).json()["fields"]) == stored
