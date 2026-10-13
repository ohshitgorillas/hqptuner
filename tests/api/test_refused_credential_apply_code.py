"""The code a persistent apply answers when hqplayerd refuses the management credential mid-apply.

The edit is staged while the fake 8088 daemon still accepts the pair, then the daemon starts
answering the digest with 403 (`fake_http._auth_refusal`, verified on 6.0.4), so the apply's own
fetch is what meets the refusal. A refusal recorded before the write is the manager case
(`tests/apply/test_credentials_refused_code.py`).
"""

from typing import Any

from fastapi.testclient import TestClient
from narrow import FixtureError

#: The code a refused credential carries, distinct from the one an install with no credential carries.
CREDENTIALS_REFUSED = "credentials_refused"


def _require_unrecorded_refusal(client: TestClient) -> None:
    """Stop the test if the lane already recorded the refusal, since then the apply never met it itself."""
    if client.get("/api/health").json().get("credentials_ok") is False:
        raise FixtureError(reason="the lane recorded the refusal before the apply, so the mid-apply case never set up")


def test_an_apply_whose_fetch_meets_a_refused_credential_answers_code_credentials_refused(
    http_client: TestClient, http_daemon: dict[str, Any]
) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    http_daemon["_refuse_auth"] = True
    _require_unrecorded_refusal(http_client)
    assert http_client.post("/api/config/apply").json()["code"] == CREDENTIALS_REFUSED
