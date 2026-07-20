"""Write-path REST surface: staging validation, the pending buffer, and apply
guards (docs/testing.md). The manager is pointed at a closed local port, so the
connection endpoints under test never reach a real daemon; the connected apply
path is validated live on Opal (roadmap Phase 3 exit criteria)."""

import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.presetconf import UNGROUNDED


def _closed_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
def client() -> Iterator[TestClient]:
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=_closed_port())
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


@pytest.fixture
def http_client(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    # http lane wired to the faithful fake daemon; control lane at a closed port
    # (an http-only apply never touches it). Small alarm so a rejected apply
    # times out fast; backup lands in tmp, not the repo.
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=_closed_port(),
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
    )
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


def test_stage_rejects_unknown_live_setting(client: TestClient) -> None:
    resp = client.post("/api/config/stage", json={"live": {"bogus": {"value": "1"}}})
    assert resp.status_code == 422


@pytest.mark.parametrize("field", sorted(UNGROUNDED))
def test_stage_rejects_an_ungrounded_config_field(client: TestClient, field: str) -> None:
    # the corrective XML apply has no verified location for these yet, so staging
    # one is refused rather than letting a guessed attribute reach a live daemon
    resp = client.post("/api/config/stage", json={"http": {field: "1"}})
    assert resp.status_code == 422


def test_staged_edit_is_returned_by_pending(client: TestClient) -> None:
    client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    assert client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


def test_discard_clears_the_pending_buffer(client: TestClient) -> None:
    client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    client.delete("/api/config/pending")
    assert client.get("/api/config/pending").json()["live"] == {}


def test_apply_with_nothing_staged_is_rejected(client: TestClient) -> None:
    assert client.post("/api/config/apply").status_code == 400


def test_failed_apply_preserves_the_staged_edits(client: TestClient) -> None:
    # daemon unreachable (closed port) → apply fails; staging must survive so
    # the user does not silently lose the edit
    client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    client.post("/api/config/apply")
    assert client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


def test_soft_failed_http_apply_preserves_staging(http_client: TestClient) -> None:
    # daemon answers 200 but rejects the value (no exception) → apply reports
    # not-applied; staging must survive so the user can retry, not vanish
    http_client.post("/api/config/stage", json={"http": {"title": "REJECT"}})
    http_client.post("/api/config/apply")
    assert http_client.get("/api/config/pending").json()["http"]["title"] == "REJECT"


def test_successful_http_apply_clears_staging(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/apply")
    assert http_client.get("/api/config/pending").json()["http"] == {}


def test_unknown_profile_action_is_not_found(client: TestClient) -> None:
    assert client.post("/api/profile/bogus", json={"name": "x"}).status_code == 404


def test_profile_action_requires_a_name(client: TestClient) -> None:
    assert client.post("/api/profile/load", json={"name": ""}).status_code == 422
