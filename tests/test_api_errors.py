"""REST error contracts: the guards and status mappings the frontend keys off.
Every error is driven through app construction (no credentials configured) or
through the wire (a daemon that is absent, down, or refusing) — never by
patching our own code (docs/testing.md)."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from conftest import wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.presets.presetstore import PresetStore


@pytest.fixture
def nocreds_client(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """App built with no hqplayerd credentials — no http client exists at all.
    The store is pre-seeded with one preset so preset-shaped requests fail on
    the missing lane (503), never on a missing name (404)."""
    PresetStore(tmp_path / "presets").save("Kept", b"<hqplayerd/>")
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg)) as client:
        yield client


@pytest.fixture
def deaf_client(tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """Credentials configured, but nothing listens on either daemon port — the
    http lane exists and every wire touch is refused."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=closed_port,
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg)) as client:
        yield client


@pytest.fixture
def half_wired_client(threaded_daemon_port: int, closed_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """Control lane live, config lane dead: the connect-time form fetches fail,
    so each form route holds a recorded error instead of a form."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=closed_port,
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg)) as client:
        # /speakers is the last form the connect sequence fetches — once it
        # reports the failed fetch, all three errors are recorded
        wait_for_api(client, lambda c: c.get("/api/speakers").status_code == 502)
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
def test_snapshot_routes_before_first_daemon_load_are_unavailable(api_client: TestClient, path: str) -> None:
    assert api_client.get(path).status_code == 503


# --- forms: not-yet-loaded vs fetch-failed (deps.ensure_form) --------------------


@pytest.mark.parametrize("path", ["/api/config", "/api/matrix", "/api/speakers"])
def test_form_routes_before_any_fetch_are_unavailable(http_client: TestClient, path: str) -> None:
    # daemon healthy and credentials present, but the manager never completed a
    # connect (control lane closed), so no form fetch was ever attempted
    assert http_client.get(path).status_code == 503


@pytest.mark.parametrize("path", ["/api/config", "/api/matrix", "/api/speakers"])
def test_form_routes_after_a_failed_fetch_are_bad_gateway(half_wired_client: TestClient, path: str) -> None:
    assert half_wired_client.get(path).status_code == 502


# --- live routes without a connected daemon --------------------------------------


def test_volume_write_without_a_daemon_is_unavailable(api_client: TestClient) -> None:
    assert api_client.post("/api/volume", json={"level": "-20"}).status_code == 503


def test_matrix_profile_switch_without_a_daemon_is_unavailable(api_client: TestClient) -> None:
    assert api_client.post("/api/matrix/profile", json={"action": "switch", "name": ""}).status_code == 503


def test_unknown_matrix_profile_action_is_not_found(api_client: TestClient) -> None:
    assert api_client.post("/api/matrix/profile", json={"action": "save", "name": "x"}).status_code == 404


def test_apply_of_a_live_edit_without_a_daemon_is_unavailable(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    assert api_client.post("/api/config/apply").status_code == 503


# --- wire failures on the config lane (502 family) --------------------------------


def test_engine_read_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.get("/api/engine").status_code == 502


def test_engine_apply_reports_unsubmitted_when_the_daemon_is_unreachable(deaf_client: TestClient) -> None:
    assert deaf_client.post("/api/engine", json={"overrides": {"cuda": "0"}}).json()["submitted"] is False


def test_restore_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    resp = deaf_client.post("/api/restore", files={"cfgfile": ("s.zip", b"PK\x03\x04junk", "application/zip")})
    assert resp.status_code == 502


def test_device_rescan_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.post("/api/config/refresh").status_code == 502


def test_speakers_apply_with_no_daemon_on_the_config_lane_is_bad_gateway(deaf_client: TestClient) -> None:
    assert deaf_client.post("/api/speakers", json={"enabled": True}).status_code == 502


def test_log_tail_reports_unavailable_when_the_log_cannot_be_read(deaf_client: TestClient) -> None:
    assert deaf_client.get("/api/log").json()["available"] is False
