"""The router's own refusals name the request they refuse.

A path no route claims, or a method a route does not take, is answered by the
router before any handler runs. Its `detail` names what the caller sent: the
path for an unrouted path, the method and the path for a wrong method. The only
strings asserted are the ones each test put on the wire itself (docs/testing.md
rule 9), and every surface carries two requests so a detail built from one
fixed literal fails the other (rule 10).
"""

import pytest
from fastapi.testclient import TestClient
from httpx import Response

#: Paths under `/api` that no route claims: one flat, one nested, so a detail
#: carrying only the first segment or a fixed path fails one of them.
UNROUTED_PATHS = ["/api/nowhere", "/api/no/such/thing"]

#: A real path paired with a method its route does not take. The methods differ
#: from each other and from the ones each route accepts, so a detail naming the
#: allowed method, or one fixed method, fails.
WRONG_METHODS = [
    pytest.param("DELETE", "/api/health", id="DELETE-health"),
    pytest.param("PUT", "/api/autosave", id="PUT-autosave"),
]

#: What `_detail` reads off an answer whose `detail` is not a sentence. No
#: request path or method is contained in it, so a missing or structured
#: detail fails the assertion instead of erroring out of it.
NO_DETAIL = ""


def _send(client: TestClient, method: str, path: str) -> Response:
    resp: Response = client.request(method, path, follow_redirects=False)
    return resp


def _detail(resp: Response) -> str:
    """The `detail` sentence of an answer, or ``NO_DETAIL``."""
    body = resp.json()
    detail = body.get("detail", NO_DETAIL) if isinstance(body, dict) else NO_DETAIL
    return detail if isinstance(detail, str) else NO_DETAIL


@pytest.mark.parametrize("path", UNROUTED_PATHS)
def test_an_unrouted_path_is_refused_with_a_detail_naming_that_path(api_client: TestClient, path: str) -> None:
    assert path in _detail(_send(api_client, "GET", path))


@pytest.mark.parametrize(("method", "path"), WRONG_METHODS)
def test_a_wrong_method_is_refused_with_a_detail_naming_that_method(
    api_client: TestClient, method: str, path: str
) -> None:
    assert method in _detail(_send(api_client, method, path))


@pytest.mark.parametrize(("method", "path"), WRONG_METHODS)
def test_a_wrong_method_is_refused_with_a_detail_naming_that_path(
    api_client: TestClient, method: str, path: str
) -> None:
    assert path in _detail(_send(api_client, method, path))
