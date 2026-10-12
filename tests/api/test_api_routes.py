"""Read-model REST routes end to end: the app under TestClient connects to a
threaded fake control daemon (the 4321 wire protocol, conftest) and to the
faithful fake 8088 config daemon, so every route body serves what the fakes
answered over the wire."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from apps import wait_for_api
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config


def _config_loaded(client: TestClient) -> bool:
    """Connect-and-load has finished: the /config form is served, the file view
    is grounded, and the daemon's data/cfgs/Test.xml migrated into the store —
    the last steps of the manager's connect sequence, in that order."""
    resp = client.get("/api/config")
    if resp.status_code != 200:
        return False
    data = resp.json()["data"]
    options = [o["value"] for o in data["profiles"]["options"]]
    return "title" in data["file"] and "Test" in options


@pytest.fixture
def wired_api(threaded_daemon_port: int, http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    """Both lanes live: control on the threaded fake, config on the fake 8088."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=0.05,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg, VirtualClock())) as client:
        wait_for_api(client, _config_loaded)
        yield client


# --- which chain's controls are live-adjustable -------------------------------
# GetFilters/GetShapers answer for the ACTIVE mode's chain only, so the frontend
# has to know which chain is loaded before it can offer a filter or shaper as a
# live control. /api/state answers it rather than the browser, because the
# fallback below is not derivable from State alone.
#
# Uncovered on purpose: the resolver also treats a `DSD`-prefixed active_mode as
# SDM. No daemon has been observed emitting one — the live engine reports the
# GetModes display name verbatim ("SDM (DSD)") — so a case for it would assert a
# guess about the wire back at the fake.


def test_a_configured_pcm_mode_is_the_live_chain(chain_api: Callable[..., TestClient]) -> None:
    assert chain_api(mode="1").get("/api/state").json()["data"]["active_chain"] == "pcm"


def test_a_configured_sdm_mode_is_the_live_chain(chain_api: Callable[..., TestClient]) -> None:
    assert chain_api(mode="2").get("/api/state").json()["data"]["active_chain"] == "sdm"


# --- immediate live writes (POST /api/config/live) -----------------------------
# The LIVE view's whole write path: config-form-domain values in, applied and
# readback-verified on the spot. Never staged, never persistent — so the
# assertions are on what the daemon reports afterwards, which is the only thing
# that distinguishes an applied write from an accepted one.


def test_a_live_write_lands_on_the_engine(live_api: TestClient) -> None:
    live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert live_api.get("/api/state").json()["data"]["filter_junk"] == "1"


def test_a_filter_value_is_translated_from_the_config_domain(chain_api: Callable[..., TestClient]) -> None:
    # enum ID 23 is `sinc-M`, which sits at list INDEX 1 on the SDM chain. 23 is a
    # plausible index as well, so a write that skipped the translation would land
    # on a different filter rather than fail.
    client = chain_api(mode="2")
    client.post("/api/config/live", json={"fields": {"oversampling": "23"}})
    assert client.get("/api/state").json()["data"]["filterNx"] == "1"


@pytest.mark.parametrize(
    ("field", "value"),
    [("oversampling", "9999"), ("adaptive_volume", "1.5")],
)
def test_a_refused_batch_applies_nothing(chain_api: Callable[..., TestClient], field: str, value: str) -> None:
    # All-or-nothing: the LIVE page has no Apply button to retry from, so a half
    # applied batch would leave the engine where no control on the page describes.
    # `9999` is in no filter list the engine offers, which is what a refusal is
    # now: a dormant-chain field is HELD rather than refused, so the batch that
    # used to demonstrate this no longer refuses at all. `1.5` is outside the
    # 0/1 domain of the adaptive flag, the other shape of refusal.
    client = chain_api(mode="2")
    client.post("/api/config/live", json={"fields": {field: value, "junk_filter": "1"}})
    assert client.get("/api/state").json()["data"]["filter_junk"] == "0"


def test_an_unknown_live_field_is_refused(live_api: TestClient) -> None:
    assert live_api.post("/api/config/live", json={"fields": {"nope": "1"}}).status_code == 422


def test_a_live_write_leaves_the_staged_buffer_alone(live_api: TestClient) -> None:
    # The pending buffer is shared with the tabs view and `POST /config/apply`
    # flushes all of it — a LIVE control must never be the thing that applies an
    # edit the user staged elsewhere.
    live_api.post("/api/config/stage", json={"http": {"title": "Opal"}})
    live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert live_api.get("/api/config/pending").json()["http"] == {"title": "Opal"}


# --- /config read model (form + file ⊕ live overrides + preset store) ---------


def test_config_file_view_prefers_the_live_engine_filter_over_the_file(wired_api: TestClient) -> None:
    # the config XML says filter=40, but State reports list index 0 = enum 0:
    # the live overlay must win, or the file view reports a setting the engine
    # stopped using
    assert wired_api.get("/api/config").json()["data"]["file"]["filter"] == "0"


def test_config_active_preset_is_the_stores_truth(wired_api: TestClient) -> None:
    # nothing is staged, so the save rides an apply of the "(no preset)" switch
    wired_api.post("/api/config/apply", json={"switch_to": "", "save": {"name": "Mine"}})
    assert wired_api.get("/api/config").json()["data"]["active"] == "Mine"


# --- static surface (no daemon involved) ----------------------------------------


def test_spa_assets_demand_revalidation(api_client: TestClient) -> None:
    assert api_client.get("/").headers["cache-control"] == "no-cache"
