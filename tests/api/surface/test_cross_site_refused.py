"""A state-changing request another website sent is refused, whatever cookie it carries (docs/testing.md).

Every case runs against the real app on the fake 8088 daemon. The test client addresses its requests to ``testserver``,
so a request's own site is ``http://testserver``. ``detail`` is copy and is never asserted (rule 9).
"""

from collections.abc import Callable

import pytest
from apps import log_in
from fastapi.testclient import TestClient

GatedApp = Callable[..., TestClient]

#: One state-changing route per method the check covers, each a route that answers 200 to a logged-in caller.
WRITES: list[tuple[str, str, dict[str, list[str]] | None]] = [
    ("PUT", "/api/favorites", {"filters": []}),
    ("POST", "/api/config/refresh", None),
    ("DELETE", "/api/config/pending", None),
]

FOREIGN = [
    {"Origin": "http://elsewhere.example"},
    {"Origin": "http://testserver:9999"},
    {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Sec-Fetch-Site": "same-site"},
]

OWN = [
    {},
    {"Origin": "http://testserver"},
    {"Sec-Fetch-Site": "same-origin"},
    {"Sec-Fetch-Site": "none"},
    {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"},
]


def code_of(client: TestClient, method: str, path: str, body: object, headers: dict[str, str]) -> str:
    """The ``code`` the answer carries, or "" for an answer without one."""
    answer = client.request(method, path, json=body, headers=headers)
    payload = answer.json() if answer.headers.get("content-type", "").startswith("application/json") else {}
    return str(payload.get("code", "")) if isinstance(payload, dict) else ""


@pytest.mark.parametrize("headers", FOREIGN)
@pytest.mark.parametrize(("method", "path", "body"), WRITES)
def test_a_logged_in_write_sent_from_another_site_is_refused(
    gated_app: GatedApp, method: str, path: str, body: object, headers: dict[str, str]
) -> None:
    client = log_in(gated_app())
    answer = client.request(method, path, json=body, headers=headers)
    assert (answer.status_code, answer.json()["code"]) == (403, "cross_site_refused")


@pytest.mark.parametrize("headers", OWN)
def test_a_write_the_page_or_a_script_sends_is_not_refused(gated_app: GatedApp, headers: dict[str, str]) -> None:
    client = log_in(gated_app())
    assert client.put("/api/favorites", json={"filters": []}, headers=headers).status_code == 200


@pytest.mark.parametrize("headers", FOREIGN)
def test_a_cross_site_write_with_no_login_is_refused_as_cross_site_not_as_logged_out(
    gated_app: GatedApp, headers: dict[str, str]
) -> None:
    assert code_of(gated_app(), "PUT", "/api/favorites", {"filters": []}, headers) == "cross_site_refused"


def test_a_write_with_no_login_and_no_foreign_header_meets_the_gate(gated_app: GatedApp) -> None:
    assert code_of(gated_app(), "PUT", "/api/favorites", {"filters": []}, {}) == "login_required"


def test_the_login_route_refuses_a_login_sent_from_another_site(gated_app: GatedApp) -> None:
    body = {"username": "admin", "password": "pw", "remember": False}
    answer = gated_app().post("/api/login", json=body, headers={"Origin": "http://elsewhere.example"})
    assert (answer.status_code, answer.json()["code"]) == (403, "cross_site_refused")


@pytest.mark.parametrize("headers", FOREIGN)
def test_a_read_sent_from_another_site_is_not_refused_as_cross_site(
    gated_app: GatedApp, headers: dict[str, str]
) -> None:
    client = log_in(gated_app())
    assert client.get("/api/favorites", headers=headers).status_code == 200
