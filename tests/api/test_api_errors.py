"""REST error contracts: the guards and status mappings the frontend keys off.
Every app starts ready on both lanes, and each error is driven by taking a lane
or the 8088 client away mid-run (a daemon that is down, or refusing) — or by an
app started with neither lane answering — never by patching our own code
(docs/testing.md)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from apps import blank_the_pair, live_app, unserved_login
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore


@pytest.fixture
def nocreds_client(threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """An app ready on both lanes that then loses its 8088 client — no http client exists at all.
    The store is pre-seeded with one preset so preset-shaped requests fail on
    the missing lane (503), never on a missing name (404)."""
    PresetStore(tmp_path / "presets").save("Kept", b"<hqplayerd/>")
    for client in live_app(threaded_daemon_port, tmp_path):
        blank_the_pair(client)
        yield client


@pytest.fixture
def deaf_client(http_client: TestClient, http_daemon: dict[str, Any]) -> TestClient:
    """An app ready on both lanes whose 8088 daemon then stops answering — the
    http lane exists and every wire touch is refused."""
    http_daemon["_take_lane_down"]()
    return http_client


@pytest.fixture
def unloaded_client(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """An app started with neither lane answering, so no daemon reading was ever taken."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with unserved_login(cfg, VirtualClock()) as client:
        yield client


# --- the no-credentials contract (deps.require_credentials) ---------------------


@pytest.mark.parametrize(
    "path",
    ["/api/config", "/api/matrix", "/api/speakers", "/api/engine", "/api/backup", "/api/preset/Kept"],
)
def test_config_routes_without_credentials_are_unavailable(nocreds_client: TestClient, path: str) -> None:
    assert nocreds_client.get(path).status_code == 503


def test_no_credentials_still_serves_health(nocreds_client: TestClient) -> None:
    assert nocreds_client.get("/api/health").status_code == 200


def test_no_credentials_still_buffers_staged_edits(nocreds_client: TestClient) -> None:
    nocreds_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    assert nocreds_client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


def test_profile_load_without_credentials_is_unavailable(nocreds_client: TestClient) -> None:
    # the preset exists in the store, so the failure is the missing http lane
    assert nocreds_client.post("/api/profile/load", json={"name": "Kept"}).status_code == 503


# --- snapshots before the first daemon load (deps.snapshot) ----------------------


@pytest.mark.parametrize("path", ["/api/state", "/api/status", "/api/enumerations"])
def test_snapshot_routes_before_first_daemon_load_are_unavailable(unloaded_client: TestClient, path: str) -> None:
    assert unloaded_client.get(path).status_code == 503


# --- forms: not-yet-loaded vs fetch-failed (deps.ensure_form) --------------------


@pytest.mark.parametrize("path", ["/api/config", "/api/matrix", "/api/speakers"])
def test_form_routes_before_any_fetch_are_unavailable(unloaded_client: TestClient, path: str) -> None:
    # credentials present, but neither daemon answered at start-up, so the manager
    # never completed a connect and no form fetch was ever attempted
    assert unloaded_client.get(path).status_code == 503


# --- live routes without a connected daemon --------------------------------------


def test_volume_write_without_a_daemon_is_unavailable(daemonless_client: TestClient) -> None:
    assert daemonless_client.post("/api/volume", json={"level": "-20"}).status_code == 503


def test_matrix_profile_switch_without_a_daemon_is_unavailable(daemonless_client: TestClient) -> None:
    assert daemonless_client.post("/api/matrix/profile", json={"action": "switch", "name": ""}).status_code == 503


def test_unknown_matrix_profile_action_is_not_found(api_client: TestClient) -> None:
    assert api_client.post("/api/matrix/profile", json={"action": "save", "name": "x"}).status_code == 404


def test_apply_of_a_live_edit_without_a_daemon_is_unavailable(daemonless_client: TestClient) -> None:
    daemonless_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    assert daemonless_client.post("/api/config/apply").status_code == 503


# --- wire failures on the config lane (502 family) --------------------------------


def test_engine_read_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.get("/api/engine").status_code == 502


@pytest.mark.parametrize(
    ("client", "expected"),
    [pytest.param("deaf_client", 502, id="unreachable"), pytest.param("http_client", 200, id="reachable")],
)
def test_engine_apply_reports_submitted_only_when_the_daemon_is_reachable(
    request: pytest.FixtureRequest, client: str, expected: int
) -> None:
    app: TestClient = request.getfixturevalue(client)
    assert app.post("/api/engine", json={"overrides": {"cuda": "0"}}).status_code == expected


def test_restore_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    resp = deaf_client.post("/api/restore", files={"cfgfile": ("s.zip", b"PK\x03\x04junk", "application/zip")})
    assert resp.status_code == 502


def test_device_rescan_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.post("/api/config/refresh").status_code == 502


def test_speakers_apply_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.post("/api/speakers", json={"enabled": True}).status_code == 502


def test_log_tail_is_bad_gateway_when_the_log_cannot_be_read(deaf_client: TestClient) -> None:
    assert deaf_client.get("/api/log").status_code == 502


def test_log_tail_names_the_failed_read_by_code_when_the_log_cannot_be_read(deaf_client: TestClient) -> None:
    assert deaf_client.get("/api/log").json()["code"] == "daemon_read_failed"


def test_log_tail_reports_the_read_lines_when_the_log_can_be_read(http_client: TestClient) -> None:
    assert http_client.get("/api/log", params={"lines": 2}).json()["lines"] == ["log line 59", "log line 60"]


# --- a raw framework refusal with no code in the shared table --------------------


def test_a_malformed_multipart_upload_answers_without_our_error_shape(api_client: TestClient) -> None:
    # Starlette rejects the body before the route runs, with a status our code table
    # does not map — the shared handler falls back to FastAPI's own rendering, which
    # carries no "code" field
    resp = api_client.post("/api/restore", content=b"junk", headers={"content-type": "multipart/form-data; boundary=x"})
    assert "code" not in resp.json()
