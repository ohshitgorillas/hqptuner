"""The /api/health surface (docs/testing.md). The manager is pointed at a closed
local port, so these cases cover what the route reports without a daemon."""

from apps import app_manager, app_static
from fastapi.testclient import TestClient

from hqptuner import __version__
from hqptuner.api.routes.status import health


def test_health_reports_hqptuners_own_version(api_client: TestClient) -> None:
    assert api_client.get("/api/health").json()["app_version"] == __version__


def test_health_reports_the_managers_loaded_at_as_connected_at(live_api: TestClient) -> None:
    mgr = app_manager(live_api)
    assert health(mgr, app_static(live_api)).connected_at == mgr.readings.loaded_at


def test_health_route_function_app_version(api_client: TestClient) -> None:
    mgr = app_manager(api_client)
    assert health(mgr, app_static(api_client)).app_version == __version__
