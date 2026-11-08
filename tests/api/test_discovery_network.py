"""Discovery and the alias adoption dial the daemons through the network they are handed.

Policy: docs/testing.md. The responder, the control fakes and the 8088 fake are served only in process, at addresses
no socket answers on, so a search or a start that ignored the network it was handed would find nobody.
"""

import dataclasses
import functools
from pathlib import Path

import fake_discovery
import fake_http
import fake_network
import pytest
from apps import METADATA_MIN, log_in, settle_app
from fake_control import DEFAULTS, serve_shared
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.discovery import REQUEST, Search, discover

#: Where the responder and its control fake sit, and the alias a start falls back to.
DAEMON_HOST = "127.0.0.2"
ALIAS_HOST = "127.0.0.3"

#: The datagram this test's responder answers `REQUEST` with: attributes only, the sender's address is the host.
REPLY = b'<?xml version="1.0" encoding="UTF-8"?><discover name="Studio" version="6"/>'

#: What `fake_control` answers `GetInfo` with, as (product, platform).
IDENTITY = ("Signalyst HQPlayer Embedded", "Linux")


def _config(tmp_path: Path) -> Config:
    return Config(
        metering_enabled=False,
        data_dir=METADATA_MIN,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
        connection_file=tmp_path / "connection.json",
    )


async def test_a_search_handed_the_network_lists_the_daemon_the_responder_names() -> None:
    clock = VirtualClock()
    with (
        fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS)), host=DAEMON_HOST) as control,
        fake_discovery.in_process({REQUEST: REPLY}, host=DAEMON_HOST) as port,
    ):
        search = Search(target=f"{DAEMON_HOST}:{port}", alias="127.0.0.9", control_port=control)
        found = await discover(
            search,
            3.0,
            clock=clock.monotonic,
            sleep=clock.sleep,
            deadline=clock,
            opener=fake_network.NETWORK.open_stream,
            datagrams=fake_network.NETWORK.open_datagram,
        )
    assert [(daemon.address, daemon.product, daemon.platform) for daemon in found] == [(DAEMON_HOST, *IDENTITY)]


def test_the_discover_route_on_an_app_handed_the_network_lists_the_same(tmp_path: Path) -> None:
    daemon = fake_http.spawn(fake_http.state(), in_process=True)
    http = next(daemon)
    with (
        fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS)), host=DAEMON_HOST) as control,
        fake_discovery.in_process({REQUEST: REPLY}, host=DAEMON_HOST) as port,
    ):
        cfg = dataclasses.replace(
            _config(tmp_path),
            hqp_host="127.0.0.1",
            hqp_http_port=http["_port"],
            hqp_username="u",
            hqp_password="p",
            hqp_control_port=control,
            container_host_alias="127.0.0.9",
            discovery_target=f"{DAEMON_HOST}:{port}",
            discovery_timeout=1.0,
        )
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)) as client:
            log_in(client)
            body = client.get("/api/discover").json()
    next(daemon, None)
    assert [(entry["address"], entry["product"], entry["platform"]) for entry in body] == [(DAEMON_HOST, *IDENTITY)]


@pytest.mark.parametrize(("refuses", "verdict"), [(False, True), (True, False)])
def test_a_start_with_no_host_adopts_the_alias_served_in_process(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, refuses: bool, verdict: bool
) -> None:
    monkeypatch.delenv("HQPTUNER_HQP_HOST", raising=False)
    daemon = fake_http.spawn(fake_http.state(_refuse_auth=refuses), host=ALIAS_HOST, in_process=True)
    http = next(daemon)
    with fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS)), host=ALIAS_HOST) as control:
        cfg = dataclasses.replace(
            _config(tmp_path),
            hqp_control_port=control,
            hqp_http_port=http["_port"],
            hqp_username="u",
            hqp_password="p",
            container_host_alias=ALIAS_HOST,
        )
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)) as client:
            settle_app(client)
            health = client.get("/api/health").json()
    next(daemon, None)
    assert (health["reachable"], health["credentials_ok"]) == (True, verdict)
