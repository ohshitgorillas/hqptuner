"""The /api/health surface (docs/testing.md). The manager is pointed at a closed
local port, so these cases cover what the route reports without a daemon."""

from fastapi.testclient import TestClient

from hqptuner import __version__


def test_health_reports_hqptuners_own_version(api_client: TestClient) -> None:
    assert api_client.get("/api/health").json()["app_version"] == __version__
