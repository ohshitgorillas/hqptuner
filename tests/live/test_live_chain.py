"""The per-chain filter/shaper memory LIVE keeps for the engine.

`GetFilters`/`GetShapers` enumerate the ACTIVE mode's chain only, and the two
chains number the same names differently — `poly-sinc-gauss-long` is enum ID 40
under PCM `filter` and 38 under SDM `oversampling` (readme
§1.5/§1.6). So the engine can only be told about the chain it has loaded, while
the LIVE page shows both: an edit to the dormant chain is HELD rather than
refused (the config form and hqplayerd.xml speak enum IDs, `Set*` speaks list
indices, and "the two domains must never be mixed").

Everything here runs against the stateful fake daemon over a real socket — the
assertions are on what the daemon reports afterwards, on the traffic that
reached it, and on what the config side is told.
"""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from apps import connection_stands, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _live_app(control_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """Control lane only — no credentials, so the app talks 4321 alone."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg, VirtualClock())) as client:
        wait_for_api(client, connection_stands)
        yield client


@pytest.fixture
def chain_api(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the control-only app on a fake daemon carrying the given State and
    Status overrides (the pattern in test_api_routes.py): which chain the engine
    has loaded is a different daemon situation per case."""
    daemons: list[Iterator[int]] = []
    apps: list[Iterator[TestClient]] = []

    def build(**values: str) -> TestClient:
        daemon = spawn_threaded_daemon(values)
        daemons.append(daemon)
        app = _live_app(next(daemon), tmp_path)
        apps.append(app)
        return next(app)

    yield build
    for app in apps:
        next(app, None)
    for daemon in daemons:
        next(daemon, None)


# --- an edit to the chain the engine has not loaded ---------------------------
# The engine cannot be told about it, so it is held rather than refused: the LIVE
# page shows both chains and has no Apply button to come back to.


def test_a_held_filter_edit_leaves_the_running_filter_alone(chain_api: Callable[..., TestClient]) -> None:
    # enum 23 is `sinc-M` on the SDM chain and index 1 there; the PCM chain the
    # engine is running has `sinc-M` at index 2. A held edit that leaked onto the
    # wire would move the filter the listener is hearing, either way.
    client = chain_api(mode="1", filterNx="2")
    client.post("/api/config/live", json={"fields": {"oversampling": "23"}})
    assert client.get("/api/state").json()["data"]["filterNx"] == "2"


def test_a_held_shaper_edit_leaves_the_running_shaper_alone(chain_api: Callable[..., TestClient]) -> None:
    # enum 5 is `NS9`, index 1 of the dormant PCM shaper list and absent from the
    # SDM list the engine is running. The engine sits at index 0, so a leak
    # resolved against either chain's list moves it.
    client = chain_api(mode="2", shaper="0")
    client.post("/api/config/live", json={"fields": {"dither": "5"}})
    assert client.get("/api/state").json()["data"]["shaper"] == "0"


# --- an edit to the chain the engine IS running -------------------------------


def test_an_edit_to_the_loaded_chain_is_reported_as_applied(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert resp.json()["report"]["live"] == [{"setting": "filter", "ok": True}]
