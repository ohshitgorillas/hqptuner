"""The manager and the app dial the daemon through the network they are handed.

Policy: docs/testing.md. The fake answers only in process, on no TCP port, so a manager or an app that ignored the
network it was handed would be refused.
"""

import functools
from pathlib import Path
from typing import Any

import fake_network
import pytest
from apps import METADATA_MIN, advance_app, app_manager, closed_port, ready_app, settled
from conftest import StartManager
from fake_control import DEFAULTS, serve_shared, take_lane_down
from virtual_clock import VirtualClock

from hqptuner.config import Config


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
def test_an_app_handed_the_network_reports_reachable_where_a_daemon_is_served(
    tmp_path: Path, http_daemon: dict[str, Any], *, served: bool
) -> None:
    control_state = dict(DEFAULTS)
    with fake_network.serving(functools.partial(serve_shared, state=control_state)) as port:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            hqp_http_port=http_daemon["_port"],
            hqp_username="u",
            hqp_password="p",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        with ready_app(cfg) as client:
            if not served:
                take_lane_down(control_state)
                advance_app(client, app_manager(client).cfg.poll_interval)
            assert client.get("/api/health").json()["reachable"] is served
