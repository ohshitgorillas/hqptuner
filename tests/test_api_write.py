"""Write-path REST surface: staging validation, the pending buffer, and apply
guards (docs/testing.md). The manager is pointed at a closed local port, so the
connection endpoints under test never reach a real daemon; the connected apply
path is validated live on Opal (roadmap Phase 3 exit criteria)."""

import socket
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config


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


def test_stage_rejects_unknown_live_setting(client: TestClient) -> None:
    resp = client.post("/api/config/stage", json={"live": {"bogus": {"value": "1"}}})
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


def test_unknown_profile_action_is_not_found(client: TestClient) -> None:
    assert client.post("/api/profile/bogus", json={"name": "x"}).status_code == 404


def test_profile_action_requires_a_name(client: TestClient) -> None:
    assert client.post("/api/profile/load", json={"name": ""}).status_code == 422
