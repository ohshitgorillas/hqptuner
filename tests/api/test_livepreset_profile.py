"""The matrix profile in a live snapshot: saved off the engine or given by the
caller, refused when the engine does not list it, and switched back on apply.
Beside it, a save given values alone, and the code a Control API failure answers under.

Driven through the REST routes against the threaded fake control daemon; the
store is a real file on disk. The fake answers ``result="Error"`` for each
command its ``_error`` knob names, a daemon refusal, and drops the connection on
each command its ``_close`` knob names. Either way the route answers under the
failure's own code.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

MIXDOWN = "Mch-to-Stereo mixdown"

#: A PCM filter enum ID the fake engine lists (sinc-M), unlike the filter it runs.
OTHER_FILTER = "25"
LISTED_PROFILE = "Default"
DAEMON_REFUSED = "daemon_refused"
DAEMON_UNAVAILABLE = "daemon_unavailable"


def _seed(tmp_path: Path, fields: dict[str, str]) -> None:
    store: dict[str, Any] = {
        "schema": 6,
        "stations": {"": {"Gone": {"chain": "pcm", "fields": fields, "names": {}}}},
    }
    (tmp_path / "live-presets.json").write_text(json.dumps(store))


def _profile_save(value: str) -> dict[str, Any]:
    return {"fields": ["matrix_profile"], "values": {"matrix_profile": value}}


def _switch(client: TestClient, name: str) -> None:
    client.post("/api/matrix/profile", json={"action": "switch", "name": name})


def test_a_full_save_holds_the_engines_matrix_profile(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(matrix_profile=MIXDOWN)
    assert client.put("/api/livepresets/Warm").json()["fields"]["matrix_profile"] == MIXDOWN


def test_a_save_naming_the_matrix_profile_alone_stores_it_alone(live_api: TestClient) -> None:
    resp = live_api.put("/api/livepresets/Warm", json={"fields": ["matrix_profile"]})
    assert set(resp.json()["fields"]) == {"matrix_profile"}


def test_a_save_given_a_listed_profile_stores_it(live_api: TestClient) -> None:
    resp = live_api.put("/api/livepresets/Warm", json=_profile_save("Default"))
    assert resp.json()["fields"]["matrix_profile"] == "Default"


def test_a_save_given_a_profile_the_engine_does_not_list_is_refused(live_api: TestClient) -> None:
    assert live_api.put("/api/livepresets/Warm", json=_profile_save("Nope")).json()["code"] == "values_unknown"


def test_applying_a_preset_switches_the_engine_to_its_saved_profile(live_api: TestClient) -> None:
    live_api.put("/api/livepresets/Warm", json=_profile_save("Default"))
    _switch(live_api, MIXDOWN)
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/state").json()["data"]["matrix_profile"] == "Default"


def test_applying_a_preset_naming_a_profile_the_engine_no_longer_lists_is_a_conflict(
    live_api: TestClient, tmp_path: Path
) -> None:
    _seed(tmp_path, {"matrix_profile": "Nope"})
    assert live_api.post("/api/livepresets/Gone/apply").json()["code"] == "route_refused"


def test_a_preset_refused_for_its_profile_applies_none_of_its_other_settings(
    live_api: TestClient, tmp_path: Path
) -> None:
    _seed(tmp_path, {"matrix_profile": "Nope", "filter": "25"})
    live_api.post("/api/livepresets/Gone/apply")
    assert live_api.get("/api/state").json()["data"]["filterNx"] == "0"


def test_applying_a_preset_without_a_profile_leaves_the_engines_profile_alone(live_api: TestClient) -> None:
    live_api.put("/api/livepresets/Warm", json={"fields": ["filter"]})
    _switch(live_api, "Default")
    live_api.post("/api/livepresets/Warm/apply")
    assert live_api.get("/api/state").json()["data"]["matrix_profile"] == "Default"


def test_a_save_given_values_but_no_field_list_stores_the_given_value(live_api: TestClient) -> None:
    resp = live_api.put("/api/livepresets/Warm", json={"values": {"filter": OTHER_FILTER}})
    assert resp.json()["fields"]["filter"] == OTHER_FILTER


def test_a_connection_dropped_under_a_live_snapshots_filter_write_answers_the_errors_own_code(
    chain_api: Callable[..., TestClient],
) -> None:
    client = chain_api(_close="SetFilter")
    client.put("/api/livepresets/Warm", json={"fields": ["filter"], "values": {"filter": OTHER_FILTER}})
    assert client.post("/api/livepresets/Warm/apply").json()["code"] == DAEMON_UNAVAILABLE


def test_a_refused_matrix_profile_switch_while_applying_a_live_snapshot_answers_the_daemons_code(
    chain_api: Callable[..., TestClient],
) -> None:
    client = chain_api(matrix_profile=MIXDOWN, _error="MatrixSetProfile")
    client.put(
        "/api/livepresets/Warm", json={"fields": ["matrix_profile"], "values": {"matrix_profile": LISTED_PROFILE}}
    )
    assert client.post("/api/livepresets/Warm/apply").json()["code"] == DAEMON_REFUSED
