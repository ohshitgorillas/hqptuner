"""Write-path REST surface: staging validation, the pending buffer, and apply
guards (docs/testing.md). The manager is pointed at a closed local port, so the
connection endpoints under test never reach a real daemon; the connected apply
path is validated live on Opal. The `http_client` fixture (conftest) wires the
http lane to the faithful fake 8088 daemon for the applies that need one."""

from fastapi.testclient import TestClient


def test_stage_rejects_unknown_live_setting(api_client: TestClient) -> None:
    resp = api_client.post("/api/config/stage", json={"live": {"bogus": {"value": "1"}}})
    assert resp.status_code == 422


def test_staged_edit_is_returned_by_pending(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    assert api_client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


def test_discard_clears_the_pending_buffer(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.delete("/api/config/pending")
    assert api_client.get("/api/config/pending").json()["live"] == {}


def test_apply_with_nothing_staged_is_rejected(api_client: TestClient) -> None:
    assert api_client.post("/api/config/apply").status_code == 400


def test_failed_apply_preserves_the_staged_edits(api_client: TestClient) -> None:
    # daemon unreachable (closed port) → apply fails; staging must survive so
    # the user does not silently lose the edit
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/apply")
    assert api_client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


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


def test_unknown_profile_action_is_not_found(api_client: TestClient) -> None:
    assert api_client.post("/api/profile/bogus", json={"name": "x"}).status_code == 404


def test_profile_action_requires_a_name(api_client: TestClient) -> None:
    assert api_client.post("/api/profile/load", json={"name": ""}).status_code == 422
