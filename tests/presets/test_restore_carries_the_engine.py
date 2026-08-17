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

``test_a_staged_mode_beats_both_the_engine_and_the_store`` is a regression guard
whose contract predates this change: a staged edit has always outranked every
other source, and the case is here so carrying the engine cannot quietly take
that precedence away.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any, NamedTuple

import fake_http
import pytest
from conftest import spawn_threaded_daemon, wait_for_api
from fake_control import DEFAULTS, restart_into
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.conf import presetconf
from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore


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


def _preset_stored_on(client: TestClient, preset_dir: Path, edits: dict[str, str]) -> None:
    """Save the running config as the active preset, then move ``edits`` in its
    stored snapshot so the store disagrees with both the file and the engine."""
    client.post("/api/profile/save", json={"name": "Kept"})
    store = PresetStore(preset_dir)
    store.save("Kept", presetconf.apply_edits(store.read("Kept"), edits))


def _route_live(client: TestClient, fields: dict[str, str], state_key: str, landed: str) -> None:
    """Route ``fields`` over the control lane and prove the engine took them: a
    live route that no-opped would leave the engine where it started and every
    case below would pass vacuously. ``state_key``/``landed`` are the State
    attribute and index the daemon reports the change as (protocol.md §4 — State
    speaks indices, the config form speaks enum IDs)."""
    client.post("/api/config/live", json={"fields": fields})
    wait_for_api(client, lambda c: c.get("/api/state").json()["data"][state_key] == landed)


#: (field, live value, stored value, State attribute, landed index) per live-only
#: field the restore has to carry. ``mode`` is the switch itself; ``modulator`` is
#: routed on top of it, on the SDM chain that switch loads — enum 3 is ASDM7EC at
#: SDM shaper index 1, against a config file whose modulator is 0. Each row's
#: engine value, stored value and file value are three distinct values, so the
#: restored one names its own source.
class EngineCase(NamedTuple):
    """One live-only field routed onto the engine: the field, the value routed,
    the different value the active preset stores for it, and the State attribute
    and index the daemon reports the route as."""

    field: str
    running: str
    stored: str
    state_key: str
    landed: str


ENGINE_WINS = [
    EngineCase("mode", "sdm", "auto", "mode", "2"),
    EngineCase("modulator", "3", "7", "shaper", "1"),
]


@pytest.mark.parametrize("case", ENGINE_WINS, ids=[c.field for c in ENGINE_WINS])
def test_the_restore_boots_the_daemon_on_the_engines_value_not_the_stored_one(
    client: TestClient, pcm_file_daemon: dict[str, Any], tmp_path: Path, case: EngineCase
) -> None:
    _preset_stored_on(client, tmp_path / "presets", {case.field: case.stored})
    _route_live(client, {"mode": "sdm"}, "mode", "2")
    _route_live(client, {case.field: case.running}, case.state_key, case.landed)
    client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    client.post("/api/config/apply")
    assert pcm_file_daemon[case.field] == case.running


def test_a_staged_mode_beats_both_the_engine_and_the_store(
    client: TestClient, pcm_file_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # the batch carries a restart-required field too, so the whole thing rides
    # the restore rather than routing the mode live
    _preset_stored_on(client, tmp_path / "presets", {"mode": "pcm"})
    _route_live(client, {"mode": "sdm"}, "mode", "2")
    client.post("/api/config/stage", json={"http": {"mode": "auto", "title": "Renamed"}})
    client.post("/api/config/apply")
    assert pcm_file_daemon["mode"] == "auto"
