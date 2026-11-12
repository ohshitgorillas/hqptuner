"""``GET /api/audit`` answers at most its cap, however large a ``limit`` the request names."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hqptuner.api.routes.audit import MAX_LIMIT, audit_router
from hqptuner.audit import AuditLog

EXTRA = 25


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """The audit route over a log holding more records than the cap, written through the log's recording methods."""
    audit = AuditLog(tmp_path / "audit.jsonl")
    for _ in range(MAX_LIMIT + EXTRA):
        audit.discard({}, {})
    app = FastAPI()
    app.include_router(audit_router(audit))
    return TestClient(app)


def test_a_limit_far_above_the_cap_answers_exactly_the_cap(client: TestClient) -> None:
    assert len(client.get("/api/audit", params={"limit": MAX_LIMIT * 10}).json()["records"]) == MAX_LIMIT
