"""Every refused HQPTuner request carries a machine-readable `code` beside
FastAPI's `detail`, so a client can branch on the cause without parsing prose.

Written blind from the spec block, against the fakes alone: the app is built the
way `live_api` builds it (control lane on the threaded fake daemon, no hqplayerd
credentials, a live-snapshot store that is a real file under tmp_path). No route
handler is stubbed and no `detail` text is asserted anywhere (docs/testing.md
rule 9): `code` values are wire identifiers, `detail` is copy.
"""

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response

#: A live-snapshot store stamped by a newer HQPTuner than this build understands.
FUTURE_STORE = {"schema": 99, "presets": {}}

#: The three ways a live-snapshot delete is refused, each with the status and code a
#: client is promised, so a code shared across causes shows up as a wrong tuple.
REFUSED_READS = [
    pytest.param("Nope", None, (404, "not_found"), id="absent-name"),
    pytest.param("..", None, (422, "name_invalid"), id="invalid-name"),
    pytest.param("Warm", FUTURE_STORE, (409, "store_too_new"), id="store-too-new"),
]


@pytest.mark.parametrize(("name", "store", "expected"), REFUSED_READS)
def test_a_refused_live_preset_delete_names_its_cause_by_code(
    live_api: TestClient, tmp_path: Path, name: str, store: dict[str, object] | None, expected: tuple[int, str]
) -> None:
    if store is not None:
        (tmp_path / "live-presets.json").write_text(json.dumps(store))
    # percent-encoded whole, so `..` reaches the handler instead of resolving as a path segment
    encoded = "".join(f"%{byte:02X}" for byte in name.encode())
    resp = live_api.delete(f"/api/livepresets/{encoded}")
    assert (resp.status_code, resp.json()["code"]) == expected


def test_config_without_credentials_is_unavailable_with_code_no_credentials(live_api: TestClient) -> None:
    resp = live_api.get("/api/config")
    assert (resp.status_code, resp.json()["code"]) == (503, "no_credentials")


def test_a_live_batch_the_lane_refuses_carries_code_route_refused(live_api: TestClient) -> None:
    # 409 and the per-field reasons dict are pinned elsewhere; this pins the code
    assert live_api.post("/api/config/live", json={"fields": {"filter": "9999"}}).json()["code"] == "route_refused"


#: Every live-snapshot verb, paired with the path it is reached at for a given
#: name. A name carrying a separator is refused by the same rule whatever verb
#: carries it, so the promise is a table over the verbs, not a property of one.
LIVE_VERBS = [
    ("PUT", "/api/livepresets/{name}"),
    ("POST", "/api/livepresets/{name}/apply"),
    ("DELETE", "/api/livepresets/{name}"),
]

#: Two depths of the same wrong shape: one separator and two. A rule that sees
#: only the single-separator case leaves the deeper one to some other layer.
SLASHED_NAMES = ["a/b", "a/b/c"]

SLASHED_LIVE_REQUESTS = [
    pytest.param(method, template.format(name=name), id=f"{method}-{name}")
    for name in SLASHED_NAMES
    for method, template in LIVE_VERBS
]


def _refusal(client: TestClient, method: str, path: str) -> tuple[int, object]:
    """The status and `code` of a request sent exactly as written.

    Redirects are not followed and the name is not percent-encoded: the point is
    what the app answers to the literal slashed path a caller types, so anything
    rewriting it before the app sees it would hide the behavior under test. A
    body carrying no `code` reads as `None` rather than raising, so a refusal
    from the wrong layer fails the assertion instead of erroring out of it."""
    resp = client.request(method, path, follow_redirects=False)
    body = resp.json()
    return resp.status_code, body.get("code") if isinstance(body, dict) else None


@pytest.mark.parametrize(("method", "path"), SLASHED_LIVE_REQUESTS)
def test_a_slashed_live_snapshot_name_is_refused_by_the_name_rule(live_api: TestClient, method: str, path: str) -> None:
    assert _refusal(live_api, method, path) == (422, "name_invalid")


def test_an_unusable_live_snapshot_name_is_refused_before_the_engine_is_read(
    chain_api: Callable[..., TestClient],
) -> None:
    # one engine, two names: the slashed name is answered by the name rule and
    # the ordinary one by the engine's own state, so a save that snapshots the
    # engine first and validates the name second gives both the same answer
    chainless = chain_api(mode="0", _active_mode="")
    assert [_refusal(chainless, "PUT", f"/api/livepresets/{name}") for name in ("a/b", "Warm")] == [
        (422, "name_invalid"),
        (409, "chain_unknown"),
    ]


@pytest.mark.parametrize("path", ["/api/preset/a/b", "/api/preset/"])
def test_a_config_preset_delete_refuses_an_unusable_name_by_the_name_rule(http_client: TestClient, path: str) -> None:
    assert _refusal(http_client, "DELETE", path) == (422, "name_invalid")


#: Both verbs at a path under `/api` that no route claims. A page server mounted
#: at `/` that still catches unrouted `/api` paths answers the GET as a missing
#: file and the POST as the wrong verb, with a code on neither.
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_an_unrouted_api_path_is_unknown_whatever_the_method(api_client: TestClient, method: str) -> None:
    assert _refusal(api_client, method, "/api/nowhere") == (404, "route_unknown")


def _allow_tokens(resp: Response) -> set[str]:
    """The methods an `Allow` header offers, as a set: the framework joins them in
    no fixed order, so the comparable literal is the set, not the string. A missing
    header reads as the set of one empty token, so it fails a comparison rather
    than raising out of it."""
    return {token.strip() for token in resp.headers.get("allow", "").split(",")}


def test_a_wrong_method_on_a_real_api_path_names_the_methods_it_takes(api_client: TestClient) -> None:
    # /api/health is GET-only, so the methods it takes are exactly that one
    resp = api_client.request("POST", "/api/health", follow_redirects=False)
    assert (resp.status_code, resp.json().get("code"), _allow_tokens(resp)) == (405, "method_not_allowed", {"GET"})
