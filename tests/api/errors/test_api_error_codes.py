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
from narrow import FixtureError

#: A live-snapshot store stamped by a newer HQPTuner than this build understands.
FUTURE_STORE = {"schema": 99, "presets": {}}

#: The three ways a live-snapshot delete is refused, each with the code a client
#: is promised, so a code shared across causes shows up as a wrong code.
REFUSED_DELETES = [
    ("absent-name", "Nope", None, "not_found"),
    ("invalid-name", "..", None, "name_invalid"),
    ("store-too-new", "Warm", FUTURE_STORE, "store_too_new"),
]

REFUSED_DELETE_CODES = [pytest.param(name, store, code, id=case) for case, name, store, code in REFUSED_DELETES]
REFUSED_DELETE_REQUESTS = [pytest.param(name, store, id=case) for case, name, store, _ in REFUSED_DELETES]


def _delete_live_preset(client: TestClient, tmp_path: Path, name: str, store: dict[str, object] | None) -> Response:
    if store is not None:
        (tmp_path / "live-presets.json").write_text(json.dumps(store))
    # percent-encoded whole, so `..` reaches the handler instead of resolving as a path segment
    encoded = "".join(f"%{byte:02X}" for byte in name.encode())
    resp: Response = client.delete(f"/api/livepresets/{encoded}")
    return resp


@pytest.mark.parametrize(("name", "store", "code"), REFUSED_DELETE_CODES)
def test_a_refused_live_preset_delete_names_its_cause_by_code(
    live_api: TestClient, tmp_path: Path, name: str, store: dict[str, object] | None, code: str
) -> None:
    assert _delete_live_preset(live_api, tmp_path, name, store).json()["code"] == code


@pytest.mark.parametrize(("name", "store"), REFUSED_DELETE_REQUESTS)
def test_a_refused_live_preset_delete_is_a_client_error(
    live_api: TestClient, tmp_path: Path, name: str, store: dict[str, object] | None
) -> None:
    assert _delete_live_preset(live_api, tmp_path, name, store).status_code // 100 == 4


def test_config_without_credentials_is_unavailable(live_api: TestClient) -> None:
    assert live_api.get("/api/config").status_code == 503


def test_config_without_credentials_carries_code_no_credentials(live_api: TestClient) -> None:
    assert live_api.get("/api/config").json()["code"] == "no_credentials"


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


def _send(client: TestClient, method: str, path: str) -> Response:
    """A request sent exactly as written.

    Redirects are not followed and the name is not percent-encoded: the point is
    what the app answers to the literal slashed path a caller types, so anything
    rewriting it before the app sees it would hide the behavior under test."""
    resp: Response = client.request(method, path, follow_redirects=False)
    return resp


#: What `_code` reads off an answer whose body carries no `code`. No case
#: expects it: a refusal from the wrong layer fails the assertion instead of
#: erroring out of it.
NO_CODE = ""


def _code(resp: Response) -> object:
    """The `code` of an answer, or ``NO_CODE``."""
    body = resp.json()
    return body.get("code", NO_CODE) if isinstance(body, dict) else NO_CODE


@pytest.mark.parametrize(("method", "path"), SLASHED_LIVE_REQUESTS)
def test_a_slashed_live_snapshot_name_is_refused_by_the_name_rule(live_api: TestClient, method: str, path: str) -> None:
    assert _code(_send(live_api, method, path)) == "name_invalid"


@pytest.mark.parametrize(("method", "path"), SLASHED_LIVE_REQUESTS)
def test_a_slashed_live_snapshot_name_is_a_client_error(live_api: TestClient, method: str, path: str) -> None:
    assert _send(live_api, method, path).status_code // 100 == 4


def test_an_unusable_live_snapshot_name_is_refused_before_the_engine_is_read(
    chain_api: Callable[..., TestClient],
) -> None:
    # one engine, two names: the ordinary name is answered by the engine's own
    # state, so a save that snapshots the engine first and validates the name
    # second gives the slashed name that same answer
    chainless = chain_api(mode="0", _active_mode="")
    if _code(_send(chainless, "PUT", "/api/livepresets/Warm")) != "chain_unknown":
        raise FixtureError(reason="the engine answered an ordinary save, so it is not the chainless one")
    assert _code(_send(chainless, "PUT", "/api/livepresets/a/b")) == "name_invalid"


@pytest.mark.parametrize("path", ["/api/preset/a/b", "/api/preset/"])
def test_a_config_preset_delete_refuses_an_unusable_name_by_the_name_rule(http_client: TestClient, path: str) -> None:
    assert _code(_send(http_client, "DELETE", path)) == "name_invalid"


@pytest.mark.parametrize("path", ["/api/preset/a/b", "/api/preset/"])
def test_a_config_preset_delete_of_an_unusable_name_is_a_client_error(http_client: TestClient, path: str) -> None:
    assert _send(http_client, "DELETE", path).status_code // 100 == 4


#: Both verbs at a path under `/api` that no route claims. A page server mounted
#: at `/` that still catches unrouted `/api` paths answers the GET as a missing
#: file and the POST as the wrong verb, with a code on neither.
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_an_unrouted_api_path_is_unknown_whatever_the_method(api_client: TestClient, method: str) -> None:
    assert _code(_send(api_client, method, "/api/nowhere")) == "route_unknown"


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_an_unrouted_api_path_is_a_client_error_whatever_the_method(api_client: TestClient, method: str) -> None:
    assert _send(api_client, method, "/api/nowhere").status_code // 100 == 4


def _allow_tokens(resp: Response) -> set[str]:
    """The methods an `Allow` header offers, as a set: the framework joins them in
    no fixed order, so the comparable literal is the set, not the string. A missing
    header reads as the set of one empty token, so it fails a comparison rather
    than raising out of it."""
    return {token.strip() for token in resp.headers.get("allow", "").split(",")}


def _wrong_method(client: TestClient) -> Response:
    # /api/health is GET-only, so the methods it takes are exactly that one
    return _send(client, "POST", "/api/health")


def test_a_wrong_method_on_a_real_api_path_names_the_methods_it_takes(api_client: TestClient) -> None:
    assert _allow_tokens(_wrong_method(api_client)) == {"GET"}


def test_a_wrong_method_on_a_real_api_path_carries_code_method_not_allowed(api_client: TestClient) -> None:
    assert _code(_wrong_method(api_client)) == "method_not_allowed"


def test_a_wrong_method_on_a_real_api_path_is_a_client_error(api_client: TestClient) -> None:
    assert _wrong_method(api_client).status_code // 100 == 4
