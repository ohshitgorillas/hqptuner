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


# --- unstaging: the stage body's optional `drop` member ------------------------


def test_dropped_http_field_leaves_no_entry_in_the_buffer(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post(
        "/api/config/stage",
        json={"live": {"shaper": {"value": "5"}}, "drop": {"http": ["title"]}},
    )
    assert "title" not in http_client.get("/api/config/pending").json()["http"]


def test_a_drop_of_a_never_staged_http_field_does_not_reject_the_call(http_client: TestClient) -> None:
    # a rejected call would also leave the buffer untouched, so acceptance is
    # pinned through the same call's own staged value landing
    http_client.post(
        "/api/config/stage",
        json={"http": {"title": "Renamed"}, "drop": {"http": ["channels"]}},
    )
    assert http_client.get("/api/config/pending").json()["http"]["title"] == "Renamed"


def test_dropping_a_never_staged_http_field_leaves_the_buffer_alone(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_client.post("/api/config/stage", json={"drop": {"http": ["channels"]}})
    assert http_client.get("/api/config/pending").json()["http"]["title"] == "Renamed"


def test_dropping_one_live_argument_keeps_the_other(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"filter": {"value": "1", "value1x": "2"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"filter": ["value1x"]}}})
    assert api_client.get("/api/config/pending").json()["live"]["filter"] == {"value": "1"}


def test_dropping_every_live_argument_removes_the_bucket(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"filter": {"value": "1", "value1x": "2"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"filter": ["value", "value1x"]}}})
    assert "filter" not in api_client.get("/api/config/pending").json()["live"]


def test_a_field_staged_and_dropped_in_one_call_is_absent(http_client: TestClient) -> None:
    # merge happens before the drop, so the same call's own value is removed too
    http_client.post(
        "/api/config/stage",
        json={"http": {"title": "Renamed"}, "drop": {"http": ["title"]}},
    )
    assert "title" not in http_client.get("/api/config/pending").json()["http"]


def test_a_live_argument_staged_and_dropped_in_one_call_is_absent(api_client: TestClient) -> None:
    # merge before drop on the live lane too, not only the http one
    api_client.post(
        "/api/config/stage",
        json={"live": {"shaper": {"value": "5"}}, "drop": {"live": {"shaper": ["value"]}}},
    )
    assert "shaper" not in api_client.get("/api/config/pending").json()["live"]


def test_a_drop_of_a_never_staged_live_key_does_not_reject_the_call(api_client: TestClient) -> None:
    api_client.post(
        "/api/config/stage",
        json={"live": {"shaper": {"value": "5"}}, "drop": {"live": {"filter": ["value"]}}},
    )
    assert api_client.get("/api/config/pending").json()["live"]["shaper"]["value"] == "5"


def test_dropping_a_never_staged_live_key_leaves_the_buffer_alone(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"filter": ["value"]}}})
    assert api_client.get("/api/config/pending").json()["live"] == {"shaper": {"value": "5"}}


def test_dropping_an_absent_argument_keeps_the_staged_live_key(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"filter": {"value": "1"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"filter": ["value1x"]}}})
    assert api_client.get("/api/config/pending").json()["live"]["filter"] == {"value": "1"}


def test_restaging_a_live_key_replaces_its_whole_bucket(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"filter": {"value": "1", "value1x": "2"}}})
    api_client.post("/api/config/stage", json={"live": {"filter": {"value1x": "3"}}})
    assert api_client.get("/api/config/pending").json()["live"]["filter"] == {"value1x": "3"}


def test_a_stage_call_carrying_only_a_drop_still_unstages(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"shaper": ["value"]}}})
    assert "shaper" not in api_client.get("/api/config/pending").json()["live"]


def test_pending_reflects_a_drop_made_by_an_earlier_stage_call(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"shaper": ["value"]}}})
    assert api_client.get("/api/config/pending").json()["live"] == {}


def test_a_stage_call_without_a_drop_member_still_merges(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/stage", json={"live": {"filter": {"value": "1"}}})
    assert api_client.get("/api/config/pending").json()["live"]["filter"]["value"] == "1"


def test_apply_after_dropping_the_only_staged_edit_reports_nothing_staged(api_client: TestClient) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.post("/api/config/stage", json={"drop": {"live": {"shaper": ["value"]}}})
    assert api_client.post("/api/config/apply").status_code == 400


def test_unknown_profile_action_is_not_found(api_client: TestClient) -> None:
    assert api_client.post("/api/profile/bogus", json={"name": "x"}).status_code == 404


def test_profile_action_requires_a_name(api_client: TestClient) -> None:
    assert api_client.post("/api/profile/load", json={"name": ""}).status_code == 422
