"""A LIVE rate write pins the tier's 48k-family member on the running engine.

hqplayerd keeps one exact-rate pin, written by `SetRate` with a `RatesItem`
index (docs/protocol.md §SetRate). With `auto_family` on (readme §1.2) the
engine keeps 44.1k material in its own family under that pin, so HQPTuner always
sends the tier as its 48k member and lets the engine pick the sibling per track.

Runs against the control fake on 4321 alone: what is pinned is read back off the
engine's own `State`, never off a report. The fake's PCM list carries 352800 at
index 2 and 384000 at index 4; both are 8x of their base, one tier.
"""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


@pytest.fixture
def rate_api(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """The control-only app on a fake daemon carrying the given State overrides."""
    daemons: list[Iterator[int]] = []
    apps: list[TestClient] = []

    def build(**values: str) -> TestClient:
        daemon = spawn_threaded_daemon(values)
        daemons.append(daemon)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_username="",
            hqp_password="",
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        client = TestClient(create_app(cfg))
        client.__enter__()
        apps.append(client)
        wait_for_api(client, _reachable)
        return client

    yield build
    for client in apps:
        client.__exit__(None, None, None)
    for daemon in daemons:
        next(daemon, None)


def test_a_live_rate_write_pins_the_tiers_48k_member(rate_api: Callable[..., TestClient]) -> None:
    client = rate_api(mode="1")
    client.post("/api/config/live", json={"fields": {"rate": "352800"}})
    assert client.get("/api/state").json()["data"]["rate"] == "4"
