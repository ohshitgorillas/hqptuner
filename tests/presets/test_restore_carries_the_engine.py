"""A restore boots the daemon on the mode the ENGINE is in, unless the user
staged one (docs/testing.md — behavior only, one assertion per test, public API
only, fakes speak the wire protocol).

Output mode is applied over the 4321 control lane and never reaches hqplayerd's
config file, so a restore — which restarts the daemon onto that file — has to
carry it. The authority is the running engine, because that is what the user is
hearing; the active preset's stored snapshot answers only where the engine
cannot, and a staged edit beats both.

Three distinct modes are in play so the restored one names its own source: the
8088 fake's config file says ``pcm``, the engine is switched live to ``sdm``,
and the active preset's snapshot holds a third value. The 8088 fake adopts the
uploaded ``hqplayerd.xml``, so its own record of what it booted on is the
reading — not a claim by the lane that wrote it.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fake_control import DEFAULTS, restart_into
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.conf import presetconf
from hqptuner.config import Config
from hqptuner.presets.presetstore import PresetStore


@pytest.fixture
def control_state() -> dict[str, str]:
    """The control fake's live State, shared across its connections. The
    ``_cfg_*`` knobs mirror the 8088 fake's config file, so the self-restart a
    restore triggers lands the fake on the chain that file names."""
    return {**DEFAULTS, "_cfg_dither": "0", "_cfg_modulator": "0"}


@pytest.fixture
def control_port(control_state: dict[str, str]) -> Iterator[int]:
    yield from spawn_threaded_daemon(state=control_state)


@pytest.fixture
def pcm_file_daemon(control_state: dict[str, str]) -> Iterator[dict[str, Any]]:
    """The 8088 fake whose config file says PCM. An adopted restore self-restarts
    the daemon (docs/architecture.md §1 lane 2), modelled by moving the control
    fake's State onto the config just adopted, the way one real daemon would."""
    server = fake_http.spawn(fake_http.state(mode="pcm", dither="0", modulator="0"))
    daemon = next(server)
    daemon["_on_restore"] = lambda: restart_into(control_state, daemon["mode"], daemon["dither"], daemon["modulator"])
    yield daemon
    next(server, None)


def _config_loaded(client: TestClient) -> bool:
    """Connect-and-load finished: the /config file view is grounded."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def client(control_port: int, pcm_file_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    """Both lanes live: control on the threaded fake, config on the fake 8088."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=pcm_file_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        # the restore's self-restart only reaches the manager on its next State
        # poll (the fake cannot sever the 4321 socket a real restart does), so
        # the poll runs at test pace rather than production's
        poll_interval=0.02,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as test_client:
        wait_for_api(test_client, _config_loaded)
        yield test_client


def _engine_on_sdm_with_stored_mode(client: TestClient, preset_dir: Path, stored: str) -> None:
    """Active preset stored on ``stored``, engine switched live to SDM, config
    file still on PCM. The switch is proven landed before anything is staged — a
    live route that no-opped would leave the engine on PCM and the case would
    pass vacuously."""
    client.post("/api/profile/save", json={"name": "Kept"})
    store = PresetStore(preset_dir)
    store.save("Kept", presetconf.apply_edits(store.read("Kept"), {"mode": stored}))
    client.post("/api/config/live", json={"fields": {"mode": "sdm"}})
    wait_for_api(client, lambda c: c.get("/api/state").json()["data"]["mode"] == "2")


def test_the_restore_boots_the_daemon_on_the_engines_mode_not_the_stored_one(
    client: TestClient, pcm_file_daemon: dict[str, Any], tmp_path: Path
) -> None:
    _engine_on_sdm_with_stored_mode(client, tmp_path / "presets", stored="auto")
    client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    client.post("/api/config/apply")
    assert pcm_file_daemon["mode"] == "sdm"


def test_a_staged_mode_beats_both_the_engine_and_the_store(
    client: TestClient, pcm_file_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the batch carries a restart-required field too, so the whole thing rides
    # the restore rather than routing the mode live
    _engine_on_sdm_with_stored_mode(client, tmp_path / "presets", stored="pcm")
    client.post("/api/config/stage", json={"http": {"mode": "auto", "title": "Renamed"}})
    client.post("/api/config/apply")
    assert pcm_file_daemon["mode"] == "auto"
