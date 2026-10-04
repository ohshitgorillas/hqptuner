"""Live snapshots per station, end to end over the REST routes.

A station is a config preset; the loaded one is the preset store's active
pointer, and `""`, the unnamed default, when nothing is loaded. ``GET
/api/livepresets`` answers the loaded station, its snapshots as ``presets``, and
the whole book as ``stations``; a save writes to the stations its body names,
the loaded one by default; apply and delete take ``?station=``, the loaded one
by default.

The stations are seeded straight into the preset store under ``tmp_path``, since
saving a config preset needs the 8088 lane this app does not carry. The station
delete case runs on the http lane instead, where a preset delete is a route.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.presets.store.presets import PresetStore


def seed_stations(tmp_path: Path, *names: str, loaded: str | None = None) -> None:
    """Store a config preset for each name, and point the active pointer at ``loaded``."""
    store = PresetStore(tmp_path / "presets")
    for name in names:
        store.save(name, b"<hqplayerd/>")
    store.set_active(loaded)


def book(client: TestClient) -> dict[str, Any]:
    """The whole book as ``GET /api/livepresets`` answers it, or empty when it carries none."""
    answered: dict[str, Any] = client.get("/api/livepresets").json().get("stations", {})
    return answered


def held(client: TestClient, station: str) -> list[str]:
    """The snapshot names one station holds in the book; a station the book lacks reads as ``["?"]``, never as empty."""
    return list(book(client).get(station, {"?": None}))


@pytest.mark.parametrize(
    ("loaded", "station"), [pytest.param(None, "", id="none"), pytest.param("Den", "Den", id="den")]
)
def test_the_list_names_the_loaded_station(
    live_api: TestClient, tmp_path: Path, loaded: str | None, station: str
) -> None:
    seed_stations(tmp_path, "Den", loaded=loaded)
    assert live_api.get("/api/livepresets").json().get("station") == station


@pytest.mark.parametrize(
    ("station", "names"), [pytest.param("Den", ["Warm"], id="loaded"), pytest.param("", [], id="default")]
)
def test_a_save_naming_no_station_lands_under_the_loaded_one(
    live_api: TestClient, tmp_path: Path, station: str, names: list[str]
) -> None:
    seed_stations(tmp_path, "Den", loaded="Den")
    live_api.put("/api/livepresets/Warm")
    assert held(live_api, station) == names


@pytest.mark.parametrize("station", ["", "Den"])
def test_one_save_lands_under_every_station_it_names(live_api: TestClient, tmp_path: Path, station: str) -> None:
    seed_stations(tmp_path, "Den")
    live_api.put("/api/livepresets/Warm", json={"stations": ["", "Den"]})
    assert held(live_api, station) == ["Warm"]


def test_the_loaded_stations_snapshots_are_the_list(live_api: TestClient, tmp_path: Path) -> None:
    seed_stations(tmp_path, "Den", loaded="Den")
    live_api.put("/api/livepresets/Warm", json={"stations": [""]})
    live_api.put("/api/livepresets/Cool", json={"stations": ["Den"]})
    assert [p["name"] for p in live_api.get("/api/livepresets").json()["presets"]] == ["Cool"]


def test_a_save_naming_a_station_the_preset_store_lacks_is_refused(live_api: TestClient, tmp_path: Path) -> None:
    seed_stations(tmp_path, "Den")
    resp = live_api.put("/api/livepresets/Warm", json={"stations": ["Den", "Nowhere"]})
    assert resp.json().get("code") == "stations_unknown"


@pytest.mark.parametrize(
    ("query", "status"), [pytest.param("?station=Den", 200, id="named"), pytest.param("", 404, id="loaded")]
)
def test_an_apply_reads_the_station_it_names_or_the_loaded_one(
    live_api: TestClient, tmp_path: Path, query: str, status: int
) -> None:
    seed_stations(tmp_path, "Den")
    live_api.put("/api/livepresets/Warm", json={"stations": ["Den"]})
    assert live_api.post(f"/api/livepresets/Warm/apply{query}").status_code == status


@pytest.mark.parametrize(
    ("station", "names"), [pytest.param("Den", [], id="named"), pytest.param("", ["Warm"], id="other")]
)
def test_a_delete_removes_the_snapshot_from_the_station_it_names_alone(
    live_api: TestClient, tmp_path: Path, station: str, names: list[str]
) -> None:
    seed_stations(tmp_path, "Den")
    live_api.put("/api/livepresets/Warm", json={"stations": ["", "Den"]})
    live_api.delete("/api/livepresets/Warm?station=Den")
    assert held(live_api, station) == names


@pytest.mark.parametrize(
    ("station", "names"), [pytest.param("Den", [], id="deleted"), pytest.param("Attic", ["Warm"], id="kept")]
)
def test_a_station_saved_again_after_its_delete_holds_none_of_its_old_snapshots(
    http_client: TestClient, tmp_path: Path, station: str, names: list[str]
) -> None:
    http_client.post("/api/profile/save", json={"name": "Den"})
    http_client.post("/api/profile/save", json={"name": "Attic"})
    record = {"chain": "pcm", "fields": {"adaptive_volume": "1"}, "names": {"adaptive_volume": "1"}}
    book = {"Den": {"Warm": record}, "Attic": {"Warm": record}}
    (tmp_path / "live-presets.json").write_text(json.dumps({"schema": 5, "stations": book}))
    http_client.delete("/api/preset/Den")
    http_client.post("/api/profile/save", json={"name": "Den"})
    assert held(http_client, station) == names
