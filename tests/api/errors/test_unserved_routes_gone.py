"""Four routes nothing calls are gone, and each is refused the way the error-code
table in `docs/spec/architecture.md` section 8.1 defines.

`POST /api/profile/{action}` and `POST /api/autosave` were the only routes at
their paths, so once gone no route is at that path: `route_unknown`.
`DELETE /api/preset/{name}` and `GET /api/autopilot` leave a sibling method
behind (`GET /api/preset/{name}`, `POST /api/autopilot`), so the path is still
real and the request is the wrong method on it: `method_not_allowed`. The
sibling that stays is pinned through the `Allow` header the wrong-method answer
carries, which names exactly the methods the path still takes.

Written from the spec and the committed OpenAPI snapshot alone, against the
http-lane client so every store a still-served handler could touch is in tmp.
"""

import pytest
from fastapi.testclient import TestClient
from httpx import Response

#: A preset name with no separator, so it reaches the `{name}` route segment.
PRESET = "Warm"

#: The profile actions a caller could post. A removal that keeps one action on
#: its own route still serves it, so every action is checked.
PROFILE_ACTIONS = ["save", "load", "delete"]

#: Removed routes that were alone at their path: no route answers there now.
PATHS_GONE = [
    *[pytest.param("POST", f"/api/profile/{action}", id=f"POST-profile-{action}") for action in PROFILE_ACTIONS],
    pytest.param("POST", "/api/autosave", id="POST-autosave"),
]

#: Removed methods whose path keeps a sibling method, each with the methods
#: that path still takes.
METHODS_GONE = [
    ("DELETE-preset", "DELETE", f"/api/preset/{PRESET}", {"GET"}),
    ("GET-autopilot", "GET", "/api/autopilot", {"POST"}),
]

REMOVED_METHODS = [pytest.param(method, path, id=case) for case, method, path, _ in METHODS_GONE]
KEPT_METHODS = [pytest.param(method, path, kept, id=case) for case, method, path, kept in METHODS_GONE]

#: What `_code` reads off an answer whose body carries no `code`. No case
#: expects it: an answer from a still-served handler fails the assertion
#: instead of erroring out of it.
NO_CODE = ""


def _send(client: TestClient, method: str, path: str) -> Response:
    resp: Response = client.request(method, path, follow_redirects=False)
    return resp


def _code(resp: Response) -> object:
    """The `code` of an answer, or ``NO_CODE``."""
    try:
        body = resp.json()
    except ValueError:
        return NO_CODE
    return body.get("code", NO_CODE) if isinstance(body, dict) else NO_CODE


def _allow_tokens(resp: Response) -> set[str]:
    """The methods an `Allow` header offers, as a set, since the framework joins
    them in no fixed order. A missing header reads as the set of one empty token."""
    return {token.strip() for token in resp.headers.get("allow", "").split(",")}


@pytest.mark.parametrize(("method", "path"), PATHS_GONE)
def test_a_removed_route_alone_at_its_path_answers_route_unknown(
    http_client: TestClient, method: str, path: str
) -> None:
    assert _code(_send(http_client, method, path)) == "route_unknown"


@pytest.mark.parametrize(("method", "path"), REMOVED_METHODS)
def test_a_removed_method_on_a_path_still_served_answers_method_not_allowed(
    http_client: TestClient, method: str, path: str
) -> None:
    assert _code(_send(http_client, method, path)) == "method_not_allowed"


@pytest.mark.parametrize(("method", "path", "kept"), KEPT_METHODS)
def test_a_path_that_lost_a_method_still_takes_exactly_its_kept_method(
    http_client: TestClient, method: str, path: str, kept: set[str]
) -> None:
    assert _allow_tokens(_send(http_client, method, path)) == kept
