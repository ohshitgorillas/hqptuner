"""The web app manifest and the icons it lists, as a browser installing the app fetches them."""

from fastapi.testclient import TestClient


def test_manifest_is_served_as_manifest_json(api_client: TestClient) -> None:
    content_type = api_client.get("/manifest.webmanifest").headers["content-type"]
    assert content_type.split(";")[0] == "application/manifest+json"
