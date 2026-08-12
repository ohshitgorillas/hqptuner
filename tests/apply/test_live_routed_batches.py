"""Live-routed staged batches over REST, end to end through both fake daemons
(docs/testing.md — behavior only, one assertion per test, fakes speak the wire
protocol).

A staged batch of nothing but live-capable /config fields rides the Control API
alone: the matching setter goes out (`SetShaping` for dither, list-index domain
— protocol.md §4), no restore is posted, and the report's ``persistent`` lane is
null. The moment a restart-required field shares the batch, the live routing
stands down entirely: no setter is sent, one restore carries every staged value
into the daemon's config file, and the file view serves them back. Live truth a
pure-live apply created survives the file's staleness: an armed auto-save folds
the applied dither into the active preset even after a later live mode switch,
and a live mode round trip (PCM -> SDM -> PCM) ends with the engine back on the
applied shaper index.

The control fake starts with the PCM chain loaded (mode="1"); the 8088 fake's
config file is pinned to agree (mode "pcm", dither enum "0"). On the fake's PCM
shaper list enum ID "5" (NS9) sits at list index "1", so a correctly translated
`SetShaping` carries value="1" and `State` reads shaper="1" back.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fake_control import CommandLog
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config


@pytest.fixture
def control_log() -> CommandLog:
    """The control fake's side of the wire: every command it was asked."""
    return []


@pytest.fixture
def control_port(control_log: CommandLog) -> Iterator[int]:
    yield from spawn_threaded_daemon(log=control_log)


@pytest.fixture
def pcm_file_daemon() -> Iterator[dict[str, Any]]:
    """The 8088 fake with a config file that agrees with the loaded PCM chain:
    dither enum "0" so a staged "5" is a real change, and a modulator the fake's
    SDM shaper list actually offers (enum "0" = ASDM5)."""
    yield from fake_http.spawn(fake_http.state(mode="pcm", dither="0", modulator="0"))


def _config_loaded(client: TestClient) -> bool:
    """Connect-and-load finished: the /config file view is grounded."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def client(control_port: int, pcm_file_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    """Both lanes live: control on the threaded fake, config on the fake 8088."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=pcm_file_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as test_client:
        wait_for_api(test_client, _config_loaded)
        yield test_client


def _sent(log: CommandLog, name: str) -> list[dict[str, str]]:
    return [attrs for command, attrs in log if command == name]


def _apply_staged(client: TestClient, fields: dict[str, str]) -> dict[str, Any]:
    client.post("/api/config/stage", json={"http": fields})
    return client.post("/api/config/apply").json()


# --- a batch of nothing but live-capable fields rides the Control API --------


def test_a_pure_live_dither_apply_sends_setshaping_with_the_list_index(
    client: TestClient, control_log: CommandLog
) -> None:
    # enum ID "5" is NS9 at PCM list index "1": the setter speaks indices, the
    # file speaks enum IDs, and the two must never mix (protocol.md §4)
    _apply_staged(client, {"dither": "5"})
    assert "1" in [attrs.get("value") for attrs in _sent(control_log, "SetShaping")]


def test_a_pure_live_dither_apply_reports_no_persistent_lane(client: TestClient) -> None:
    assert _apply_staged(client, {"dither": "5"})["persistent"] is None


def test_a_pure_live_dither_apply_never_restarts_the_daemon(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    # asserted at the wire: POST /restore self-restarts the daemon, so the fake's
    # arrival count is what says no restart happened
    before = pcm_file_daemon["_restore_attempts"]
    _apply_staged(client, {"dither": "5"})
    assert pcm_file_daemon["_restore_attempts"] == before


# --- one restart-required field defers the whole batch to the restore --------


def test_a_dither_beside_a_restart_field_sends_no_setshaping(client: TestClient, control_log: CommandLog) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert _sent(control_log, "SetShaping") == []


def test_a_dither_beside_a_restart_field_lands_exactly_one_restore(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    before = pcm_file_daemon["_restore_attempts"]
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["_restore_attempts"] == before + 1


def test_the_shared_restore_carries_the_new_dither_in_the_config_file(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["dither"] == "5"


def test_the_shared_restore_carries_the_restart_field_too(client: TestClient, pcm_file_daemon: dict[str, Any]) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["title"] == "Renamed"


def test_the_config_file_view_reports_the_restored_dither(client: TestClient) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert client.get("/api/config").json()["data"]["file"]["dither"] == "5"


# --- the mode defers the same way ---------------------------------------------


def test_a_mode_beside_a_restart_field_sends_no_setmode(client: TestClient, control_log: CommandLog) -> None:
    _apply_staged(client, {"mode": "sdm", "title": "Renamed"})
    assert _sent(control_log, "SetMode") == []


def test_the_shared_restore_carries_the_new_mode(client: TestClient, pcm_file_daemon: dict[str, Any]) -> None:
    _apply_staged(client, {"mode": "sdm", "title": "Renamed"})
    assert pcm_file_daemon["mode"] == "sdm"


# --- live truth outlives the stale config file --------------------------------


def test_autosave_keeps_the_applied_dither_across_a_live_mode_switch(client: TestClient) -> None:
    # the pure-live apply never touched the config file, so the file still says
    # dither "0"; the later live write's auto-save fold must not let that stale
    # value overwrite the dither the engine is actually running
    client.post("/api/profile/save", json={"name": "Kept"})
    client.post("/api/autosave", json={"enabled": True})
    _apply_staged(client, {"dither": "5"})
    client.post("/api/config/live", json={"fields": {"mode": "sdm"}})
    assert client.get("/api/preset/Kept").json()["config"]["dither"] == "5"


def test_a_live_mode_round_trip_ends_on_the_applied_shaper_index(client: TestClient) -> None:
    # SetMode swaps the shaper enumeration wholesale (protocol.md §SetMode), so
    # coming back to PCM must land the engine on the dither the user applied —
    # index "1" is where enum "5" sits on the fake's PCM list
    _apply_staged(client, {"dither": "5"})
    client.post("/api/config/live", json={"fields": {"mode": "sdm"}})
    client.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    assert client.get("/api/state").json()["data"]["shaper"] == "1"
