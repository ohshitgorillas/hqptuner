"""The per-chain filter/shaper memory LIVE keeps for the engine.

`GetFilters`/`GetShapers` enumerate the ACTIVE mode's chain only, and the two
chains number the same names differently — `poly-sinc-gauss-long` is enum ID 40
under PCM `filter` and 38 under SDM `oversampling` (protocol.md §4, readme
§1.5/§1.6). So the engine can only be told about the chain it has loaded, while
the LIVE page shows both: an edit to the dormant chain is HELD rather than
refused (the config form and hqplayerd.xml speak enum IDs, `Set*` speaks list
indices, and "the two domains must never be mixed").

Everything here runs against the stateful fake daemon over a real socket — the
assertions are on what the daemon reports afterwards, on the traffic that
reached it, and on what the config side is told, never on how any of it was
produced (docs/testing.md).
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
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, _reachable)
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


@pytest.mark.parametrize(("field", "value"), [("oversampling1x", "38"), ("oversampling", "23"), ("modulator", "3")])
def test_an_edit_to_the_dormant_sdm_chain_is_accepted(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="1")
    assert client.post("/api/config/live", json={"fields": {field: value}}).status_code == 200


@pytest.mark.parametrize(("field", "value"), [("oversampling1x", "38"), ("oversampling", "23"), ("modulator", "3")])
def test_an_edit_to_the_dormant_sdm_chain_is_reported_as_held(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


@pytest.mark.parametrize(("field", "value"), [("filter1x", "40"), ("filter", "25"), ("dither", "5")])
def test_an_edit_to_the_dormant_pcm_chain_is_reported_as_held(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="2")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


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


@pytest.mark.parametrize(("field", "value"), [("filter", "40"), ("oversampling", "23")])
def test_an_edit_is_held_when_no_chain_can_be_named(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    # [source] mode before playback starts: the configured mode cannot say which
    # chain is loaded and Status has no active mode to offer either, so NEITHER
    # chain's edit can be resolved — holding both beats refusing the page.
    client = chain_api(mode="0", _active_mode="")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


# --- an edit to the chain the engine IS running -------------------------------


def test_an_edit_to_the_loaded_chain_is_reported_as_applied(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert resp.json()["live"] == [{"setting": "filter", "ok": True}]


def test_an_edit_to_the_loaded_chain_holds_nothing(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert resp.json()["stored"] == {}


# --- what is still refused ----------------------------------------------------


def test_a_value_in_no_list_the_loaded_chain_offers_is_refused(chain_api: Callable[..., TestClient]) -> None:
    # Holding is for the chain the engine cannot answer for. For the chain it CAN
    # answer for, a value its list does not carry is an error, not a memory.
    client = chain_api(mode="2")
    assert client.post("/api/config/live", json={"fields": {"oversampling": "9999"}}).status_code == 409


def test_a_mode_change_cannot_be_batched_with_a_chain_edit(chain_api: Callable[..., TestClient]) -> None:
    # SetMode swaps the enumerations the rest of the batch was resolved against,
    # so those indices would be stale by the time their setter ran — true whether
    # the chain edit would have applied or been held.
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"mode": "sdm", "filter": "40"}})
    assert resp.status_code == 409
