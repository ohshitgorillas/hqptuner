"""The page cannot be framed, sniffed or fed a script it did not ship (docs/testing.md).

Every case runs against the real app with no daemon behind it: the SPA mount needs none. The import map's hash is
read from the ``index.html`` the mount serves, so the policy is held to the page a browser receives (rule 9).
"""

import base64
import hashlib
import re

import pytest
from fastapi.testclient import TestClient

#: A page and an asset, so the headers are held to the mount and not to the one route.
PATHS = ["/", "/app.js", "/css/base/tokens.css"]


def served_import_map_hash(client: TestClient) -> str:
    """The CSP source a browser computes for the page's inline import map, from the page as served."""
    text = re.findall(rb'<script type="importmap">(.*?)</script>', client.get("/").content, re.DOTALL)[0]
    return "sha256-" + base64.b64encode(hashlib.sha256(text).digest()).decode()


@pytest.mark.parametrize("path", PATHS)
def test_the_mount_forbids_sniffing(api_client: TestClient, path: str) -> None:
    assert api_client.get(path).headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("path", PATHS)
def test_the_mount_forbids_framing(api_client: TestClient, path: str) -> None:
    assert "frame-ancestors 'none'" in api_client.get(path).headers["content-security-policy"].split("; ")


def test_the_policy_allows_the_import_map_by_its_hash(api_client: TestClient) -> None:
    allowed = api_client.get("/").headers["content-security-policy"]
    assert f"'{served_import_map_hash(api_client)}'" in allowed


def test_the_policy_allows_no_unhashed_inline_script(api_client: TestClient) -> None:
    assert "'unsafe-inline'" not in api_client.get("/").headers["content-security-policy"]


def test_a_missing_file_is_also_marked_unsniffable(api_client: TestClient) -> None:
    assert api_client.get("/no-such-file.js").headers["x-content-type-options"] == "nosniff"


def test_the_api_json_carries_no_page_policy(api_client: TestClient) -> None:
    assert "content-security-policy" not in api_client.get("/api/health").headers


@pytest.mark.parametrize(("path", "served"), [("/app.js", "text/javascript"), ("/css/base/tokens.css", "text/css")])
def test_a_script_or_stylesheet_is_served_under_the_type_nosniff_demands(
    api_client: TestClient, path: str, served: str
) -> None:
    assert api_client.get(path).headers["content-type"].split(";")[0] == served
