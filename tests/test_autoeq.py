"""AutoEq library endpoint: the vendored blob (scripts/build_autoeq_db.py)
is served pre-gzipped with Content-Encoding so the browser's fetch sees plain
JSON — the picker lazy-loads it on first open."""

import socket
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config


def _closed_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
def client() -> Iterator[TestClient]:
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=_closed_port())
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


def test_autoeq_blob_is_served_gzip_encoded(client: TestClient) -> None:
    assert client.get("/api/autoeq").headers["content-encoding"] == "gzip"


def test_autoeq_blob_decodes_to_profiles_with_verbatim_filter_text(client: TestClient) -> None:
    profiles = client.get("/api/autoeq").json()["profiles"]
    assert any("Filter 1" in p["text"] and p["source"] and p["model"] for p in profiles)


def test_autoeq_blob_records_its_upstream_pin(client: TestClient) -> None:
    assert len(client.get("/api/autoeq").json()["meta"]["sha"]) == 40
