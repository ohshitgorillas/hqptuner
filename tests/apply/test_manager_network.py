"""The manager and the app dial the daemon through the network they are handed.

Policy: docs/testing.md. The fake answers only in process, on no TCP port, so a manager or an app that ignored the
network it was handed would be refused.
"""

import contextlib
import functools
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_network
import pytest
from apps import METADATA_MIN, closed_port, settle_app, settled
from conftest import StartManager
from fake_control import DEFAULTS, serve_shared
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config


@contextlib.contextmanager
def _control_port(*, served: bool) -> Iterator[int]:
    """A control port with a fake in process behind it, or one with nothing behind it."""
    if not served:
        yield closed_port()
        return
    with fake_network.serving(functools.partial(serve_shared, state=dict(DEFAULTS))) as port:
        yield port


@pytest.mark.parametrize("served", [True, False])
async def test_a_manager_handed_the_network_is_reachable_where_a_daemon_is_served(
    start_manager: StartManager, http_daemon: dict[str, Any], clock: VirtualClock, *, served: bool
) -> None:
    manager = await start_manager(http_daemon["_port"])
    if not served:
        manager.cfg.hqp_control_port = closed_port()
        await manager.retarget()
        await settled(clock)
    assert manager.reachable is served


@pytest.mark.parametrize("served", [True, False])
def test_an_app_handed_the_network_reports_reachable_where_a_daemon_is_served(tmp_path: Path, *, served: bool) -> None:
    with _control_port(served=served) as port:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        with TestClient(create_app(cfg, VirtualClock(), fake_network.NETWORK)) as client:
            settle_app(client)
            assert client.get("/api/health").json()["reachable"] is served
