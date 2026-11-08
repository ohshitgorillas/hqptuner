"""FastAPI's own documentation pages are not served (docs/testing.md).

The API reference is ``docs/openapi.json``; the running app serves no copy of it and no page that renders one.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_the_framework_documentation_routes_answer_not_found(api_client: TestClient, path: str) -> None:
    assert api_client.get(path).status_code == 404
