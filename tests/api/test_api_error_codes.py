"""Every refused HQPTuner request carries a machine-readable `code` beside
FastAPI's `detail`, so a client can branch on the cause without parsing prose.

Written blind from the spec block, against the fakes alone: the app is built the
way `live_api` builds it (control lane on the threaded fake daemon, no hqplayerd
credentials, a live-preset store that is a real file under tmp_path). No route
handler is stubbed and no `detail` text is asserted anywhere (docs/testing.md
rule 9): `code` values are wire identifiers, `detail` is copy.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

#: A live-preset store stamped by a newer HQPTuner than this build understands.
FUTURE_STORE = {"schema": 99, "presets": {}}

#: The three ways a live-preset read is refused, each with the status and code a
#: client is promised, so a code shared across causes shows up as a wrong tuple.
REFUSED_READS = [
    pytest.param("Nope", None, (404, "not_found"), id="absent-name"),
    pytest.param("a/b", None, (422, "name_invalid"), id="invalid-name"),
    pytest.param("Warm", FUTURE_STORE, (409, "store_too_new"), id="store-too-new"),
]


@pytest.mark.parametrize(("name", "store", "expected"), REFUSED_READS)
def test_a_refused_live_preset_read_names_its_cause_by_code(
    live_api: TestClient, tmp_path: Path, name: str, store: dict[str, object] | None, expected: tuple[int, str]
) -> None:
    if store is not None:
        (tmp_path / "live-presets.json").write_text(json.dumps(store))
    # the name is sent percent-encoded so a `/` reaches the handler as one segment
    encoded = "".join(f"%{byte:02X}" for byte in name.encode())
    resp = live_api.get(f"/api/livepresets/{encoded}")
    assert (resp.status_code, resp.json()["code"]) == expected


def test_config_without_credentials_is_unavailable_with_code_no_credentials(live_api: TestClient) -> None:
    resp = live_api.get("/api/config")
    assert (resp.status_code, resp.json()["code"]) == (503, "no_credentials")


def test_a_live_batch_the_lane_refuses_carries_code_route_refused(live_api: TestClient) -> None:
    # 409 and the per-field reasons dict are pinned elsewhere; this pins the code
    assert live_api.post("/api/config/live", json={"fields": {"rate": "12345"}}).json()["code"] == "route_refused"
