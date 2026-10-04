"""Write-path REST surface: staging validation, the pending buffer, and apply
guards (docs/testing.md). The manager is pointed at a closed local port, so the
connection endpoints under test never reach a real daemon; the connected apply
path is validated live on Opal. The `http_client` fixture (conftest) wires the
http lane to the faithful fake 8088 daemon for the applies that need one."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response


def test_stage_rejects_unknown_live_setting(api_client: TestClient) -> None:
    resp = api_client.post("/api/config/stage", json={"live": {"bogus": {"value": "1"}}})
    assert resp.status_code == 422


#: The request sent after one live edit is staged, and the live buffer it leaves:
#: a read leaves the stage alone, a discard and a later drop each empty it.
FOLLOW_UPS = [
    pytest.param("GET", "/api/config/pending", None, {"shaper": {"value": "5"}}, id="staged"),
    pytest.param("DELETE", "/api/config/pending", None, {}, id="discarded"),
    pytest.param("POST", "/api/config/stage", {"drop": {"live": {"shaper": ["value"]}}}, {}, id="dropped"),
]


@pytest.mark.parametrize(("method", "path", "body", "expected"), FOLLOW_UPS)
def test_a_discard_or_a_later_drop_empties_the_pending_buffer_a_stage_filled(
    api_client: TestClient, method: str, path: str, body: dict[str, Any] | None, expected: dict[str, Any]
) -> None:
    api_client.post("/api/config/stage", json={"live": {"shaper": {"value": "5"}}})
    api_client.request(method, path, json=body)
    assert api_client.get("/api/config/pending").json()["live"] == expected


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


@pytest.mark.parametrize(
    ("apply", "expected"),
    [pytest.param(True, {}, id="applied"), pytest.param(False, {"title": "Renamed"}, id="staged")],
)
def test_successful_http_apply_clears_staging_that_was_present_before_it(
    http_client: TestClient, expected: dict[str, Any], *, apply: bool
) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    if apply:
        http_client.post("/api/config/apply")
    assert http_client.get("/api/config/pending").json()["http"] == expected


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


def _load_without_a_name(client: TestClient) -> Response:
    resp: Response = client.post("/api/profile/load", json={"name": ""})
    return resp


def test_profile_action_requires_a_name(api_client: TestClient) -> None:
    # the empty name is refused by the shared name rule, so it carries that rule's code
    assert _load_without_a_name(api_client).json()["code"] == "name_invalid"


def test_a_profile_action_without_a_name_is_a_client_error(api_client: TestClient) -> None:
    assert _load_without_a_name(api_client).status_code // 100 == 4


def _save_with_the_daemon_down(client: TestClient, daemon: dict[str, Any]) -> Response:
    daemon["_down"] = True
    resp: Response = client.post("/api/profile/save", json={"name": "Kept"})
    return resp


def test_profile_save_when_the_daemon_goes_down_answers_the_same_as_load(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    # load's answer is pinned at exactly 502 (test_api_config_ops)
    assert _save_with_the_daemon_down(http_client, http_daemon).status_code == 502


def test_profile_save_when_the_daemon_goes_down_names_the_failed_read_by_code(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    assert _save_with_the_daemon_down(http_client, http_daemon).json()["code"] == "daemon_read_failed"
