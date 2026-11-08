"""The app builds its 8088 config client on the transport its network hands it.

Policy: docs/testing.md. The 8088 fake is served only in process, at an address no socket answers on, so a client
built without the network's transport is refused.
"""

import functools
from pathlib import Path
from typing import Any

import fake_http
import fake_network
import pytest
from apps import METADATA_MIN, settle_app
from fake_control import DEFAULTS, serve_shared
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.api.routes.connection import apply_connection
from hqptuner.config import Config
from hqptuner.core.connection import ConnectionRecord, ConnectionStore
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http.forms import FormsOutcome


@pytest.mark.parametrize(("refuses", "verdict"), [(False, True), (True, False)])
def test_an_app_handed_the_network_reports_the_verdict_the_in_process_8088_fake_gave(
    tmp_path: Path, *, refuses: bool, verdict: bool
) -> None:
    with fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS))) as control_port:
        daemon = fake_http.spawn(fake_http.state(_refuse_auth=refuses), in_process=True)
        http = next(daemon)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control_port,
            hqp_http_port=http["_port"],
            hqp_username="u",
            hqp_password="p",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)) as client:
            settle_app(client)
            assert client.get("/api/health").json()["credentials_ok"] is verdict
        next(daemon, None)


async def _applied(tmp_path: Path, http: dict[str, Any]) -> FormsOutcome:
    """What a Connection-panel save onto the in-process 8088 fake reports, on a manager built with the network."""
    cfg = Config(hqp_http_port=http["_port"], hqp_username="", hqp_password="")
    manager = ConnectionManager(cfg, clock=VirtualClock(), network=fake_network.NETWORK)
    record = ConnectionRecord(host="127.0.0.1", username="u", password="p", remember=False)
    try:
        return await apply_connection(cfg, ConnectionStore(tmp_path / "connection.json"), manager, record)
    finally:
        await manager.aclose()
        if manager.http_client is not None:
            await manager.http_client.aclose()


@pytest.mark.parametrize(("refuses", "outcome"), [(False, FormsOutcome.OK), (True, FormsOutcome.REFUSED)])
async def test_a_connection_save_reaches_the_in_process_8088_fake(
    tmp_path: Path, *, refuses: bool, outcome: FormsOutcome
) -> None:
    daemon = fake_http.spawn(fake_http.state(_refuse_auth=refuses), in_process=True)
    http = next(daemon)
    assert await _applied(tmp_path, http) is outcome
    next(daemon, None)
