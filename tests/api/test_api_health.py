"""The read-only status surface (docs/testing.md): what /api/health, /api/status and /api/log
serve. The health cases point the manager at a closed local port and cover what
the route reports without a daemon; the status cases run on the fake control
daemon; the log cases run on an 8088 daemon whose configuration form names a log file."""

from collections.abc import Callable
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import fake_http
import pytest
from apps import app_manager, app_static, log_in
from fake_network import NETWORK
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner import __version__
from hqptuner.api.factory import create_app
from hqptuner.api.routes.status import health
from hqptuner.config import Config


def test_health_reports_hqptuners_own_version(api_client: TestClient) -> None:
    assert api_client.get("/api/health").json()["app_version"] == __version__


def test_health_reports_the_managers_loaded_at_as_connected_at(live_api: TestClient) -> None:
    mgr = app_manager(live_api)
    assert health(mgr, app_static(live_api)).connected_at == mgr.readings.loaded_at


def test_health_route_function_app_version(api_client: TestClient) -> None:
    mgr = app_manager(api_client)
    assert health(mgr, app_static(api_client)).app_version == __version__


def _license(client: TestClient) -> dict[str, str]:
    license_ = client.get("/api/health").json()["license"]
    if not isinstance(license_, dict):
        raise TypeError
    return license_


def test_health_license_carries_no_licensee_name(live_api: TestClient) -> None:
    assert "name" not in _license(live_api)


def test_health_license_carries_no_fingerprint(live_api: TestClient) -> None:
    assert "fingerprint" not in _license(live_api)


def test_health_license_keeps_valid(live_api: TestClient) -> None:
    assert _license(live_api)["valid"] == "1"


TRACK = '<metadata samplerate="96000" song="Intro" uri="file:///music/private/intro.flac" other="x"/>'


def _served_metadata(chain_api: Callable[..., TestClient]) -> dict[str, str]:
    served = chain_api(_metadata=TRACK).get("/api/status").json()["data"]["metadata"]
    if not isinstance(served, dict):
        raise TypeError
    return served


@pytest.mark.parametrize("attribute", ["uri", "other"])
def test_status_metadata_leaves_out_an_attribute_the_page_does_not_read(
    attribute: str, chain_api: Callable[..., TestClient]
) -> None:
    assert attribute not in _served_metadata(chain_api)


def test_status_metadata_keeps_an_attribute_the_page_reads(chain_api: Callable[..., TestClient]) -> None:
    assert _served_metadata(chain_api)["samplerate"] == "96000"


FIXTURES = Path(__file__).parents[1] / "support" / "fixtures"


PAGES = {
    "/config": (FIXTURES / "config-form-6.0.4.html").read_bytes(),
    "/config/refresh": b"",
    "/matrix": (FIXTURES / "matrix-6.0.4.html").read_bytes(),
    "/speakers": (FIXTURES / "speakers-6.0.4.html").read_bytes(),
    "/log": b"first line\nsecond line",
}


class _LoggingDaemon(BaseHTTPRequestHandler):
    """An 8088 daemon serving the 6.0.4 configuration form, which names a log file, and a two-line log."""

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        status, body = (200, PAGES[path]) if path in PAGES else (404, b"")
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


def test_log_tail_carries_no_log_file_path(closed_port: int, tmp_path: Path) -> None:
    daemon = fake_http.spawn({}, handler=_LoggingDaemon, in_process=True)
    port = next(daemon)["_port"]
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=port,
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )
    with TestClient(create_app(cfg, VirtualClock(), NETWORK)) as client:
        log_in(client)
        client.post("/api/config/refresh")
        body = client.get("/api/log").json()
    next(daemon, None)
    assert "path" not in body
