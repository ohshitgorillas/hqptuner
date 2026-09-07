"""AutoEq library endpoint: the vendored blob (scripts/build_autoeq_db.py)
is served pre-gzipped with Content-Encoding so the browser's fetch sees plain
JSON — the picker lazy-loads it on first open."""

from fastapi.testclient import TestClient


def test_autoeq_blob_is_served_gzip_encoded(api_client: TestClient) -> None:
    assert api_client.get("/api/autoeq").headers["content-encoding"] == "gzip"


def test_autoeq_blob_records_its_upstream_pin(api_client: TestClient) -> None:
    assert len(api_client.get("/api/autoeq").json()["meta"]["sha"]) == 40
