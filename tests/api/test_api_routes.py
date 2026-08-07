"""Read-model REST routes end to end: the app under TestClient connects to a
threaded fake control daemon (the 4321 wire protocol, conftest) and to the
faithful fake 8088 config daemon, so every route body serves what the fakes
answered over the wire (docs/testing.md — fakes speak the wire protocol, no
manager internals are touched)."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import _live_app, wait_for_api
from fastapi.testclient import TestClient

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
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, _config_loaded)
        yield client


@pytest.fixture
def disabled_volume_api(threaded_disabled_volume_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The control-only app on a daemon whose VolumeRange is disabled. `live_api`
    and `chain_api`, its two siblings, are in `conftest` — the live-preset suite
    needs them too, and a fixture two modules use is a shared one."""
    yield from _live_app(threaded_disabled_volume_port, tmp_path)


# --- live snapshots (4321 lane) ----------------------------------------------


def test_state_serves_the_daemons_state_snapshot(live_api: TestClient) -> None:
    assert live_api.get("/api/state").json()["data"]["state"] == "0"


def test_state_is_not_stale_while_the_daemon_is_reachable(live_api: TestClient) -> None:
    assert live_api.get("/api/state").json()["stale"] is False


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


def test_auto_mode_takes_the_live_chain_from_the_running_engine(chain_api: Callable[..., TestClient]) -> None:
    # [source] follows the source, so the configured mode cannot say which chain
    # is loaded and Status's active mode is the only lane that can.
    client = chain_api(mode="0", _active_mode="SDM (DSD)")
    assert client.get("/api/state").json()["data"]["active_chain"] == "sdm"


def test_an_unanswerable_chain_is_reported_as_unknown(chain_api: Callable[..., TestClient]) -> None:
    # Neither lane can answer before playback starts. Null, never a guess: a
    # wrong chain offers filters that would resolve against the other chain's
    # enum IDs.
    client = chain_api(mode="0", _active_mode="")
    assert client.get("/api/state").json()["data"]["active_chain"] is None


def test_status_serves_the_engines_active_mode(live_api: TestClient) -> None:
    assert live_api.get("/api/status").json()["data"]["status"]["active_mode"] == "PCM"


def test_enumerations_report_the_active_mode_name(live_api: TestClient) -> None:
    assert live_api.get("/api/enumerations").json()["data"]["mode"]["name"] == "PCM"


def test_enumerations_serve_the_live_filter_list(live_api: TestClient) -> None:
    names = [item["name"] for item in live_api.get("/api/enumerations").json()["data"]["filters"]]
    assert "poly-sinc-gauss-long" in names


# --- live volume ---------------------------------------------------------------


def test_volume_reports_the_live_level(live_api: TestClient) -> None:
    assert live_api.get("/api/volume").json()["volume"] == "-10.0"


def test_volume_reports_the_daemons_range(live_api: TestClient) -> None:
    assert live_api.get("/api/volume").json()["min"] == "-60"


def test_volume_write_reads_back_the_applied_level(live_api: TestClient) -> None:
    assert live_api.post("/api/volume", json={"level": "-20.5"}).json()["volume"] == "-20.5"


def test_volume_write_is_rejected_when_the_daemon_disables_volume(disabled_volume_api: TestClient) -> None:
    assert disabled_volume_api.post("/api/volume", json={"level": "-20"}).status_code == 503


# --- immediate live writes (POST /api/config/live) -----------------------------
# The LIVE view's whole write path: config-form-domain values in, applied and
# readback-verified on the spot. Never staged, never persistent — so the
# assertions are on what the daemon reports afterwards, which is the only thing
# that distinguishes an applied write from an accepted one (protocol.md §6).


def test_a_live_write_lands_on_the_engine(live_api: TestClient) -> None:
    live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert live_api.get("/api/state").json()["data"]["filter_junk"] == "1"


def test_a_live_write_reports_each_setting_it_applied(live_api: TestClient) -> None:
    resp = live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert resp.json()["live"] == [{"setting": "junk_filter", "ok": True}]


def test_a_filter_value_is_translated_from_the_config_domain(chain_api: Callable[..., TestClient]) -> None:
    # enum ID 23 is `sinc-M`, which sits at list INDEX 1 on the SDM chain. 23 is a
    # plausible index as well, so a write that skipped the translation would land
    # on a different filter rather than fail (protocol.md §4 — never mix domains).
    client = chain_api(mode="2")
    client.post("/api/config/live", json={"fields": {"oversampling": "23"}})
    assert client.get("/api/state").json()["data"]["filterNx"] == "1"


def test_a_one_sided_filter_write_keeps_its_sibling(chain_api: Callable[..., TestClient]) -> None:
    # LIVE writes one control at a time, and `SetFilter value` alone sets BOTH
    # halves — so every LIVE filter write is the one-sided case.
    client = chain_api(filter1x="2", filterNx="0")
    client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert client.get("/api/state").json()["data"]["filter1x"] == "2"


def test_a_refused_batch_applies_nothing(chain_api: Callable[..., TestClient]) -> None:
    # All-or-nothing: the LIVE page has no Apply button to retry from, so a half
    # applied batch would leave the engine where no control on the page describes.
    # `9999` is in no filter list the engine offers, which is what a refusal is
    # now: a dormant-chain field is HELD rather than refused, so the batch that
    # used to demonstrate this no longer refuses at all.
    client = chain_api(mode="2")
    client.post("/api/config/live", json={"fields": {"oversampling": "9999", "junk_filter": "1"}})
    assert client.get("/api/state").json()["data"]["filter_junk"] == "0"


def test_a_mode_change_cannot_be_batched_with_other_settings(live_api: TestClient) -> None:
    # SetMode swaps the enumerations every other value in the batch was resolved
    # against, so those indices would be stale by the time their setter ran.
    resp = live_api.post("/api/config/live", json={"fields": {"mode": "pcm", "junk_filter": "1"}})
    assert resp.status_code == 409


def test_a_rate_is_translated_from_hz_to_the_engines_index(live_api: TestClient) -> None:
    # `SetRate` takes the RatesItem index; the value carried here is the actual
    # rate in Hz, which is what the item reports (it has no `value` attribute).
    live_api.post("/api/config/live", json={"fields": {"rate": "705600"}})
    assert live_api.get("/api/state").json()["data"]["rate"] == "3"


def test_a_rate_the_engine_does_not_offer_is_refused(live_api: TestClient) -> None:
    assert live_api.post("/api/config/live", json={"fields": {"rate": "12345"}}).status_code == 409


def test_an_unknown_live_field_is_refused(live_api: TestClient) -> None:
    assert live_api.post("/api/config/live", json={"fields": {"nope": "1"}}).status_code == 422


def test_a_live_write_leaves_the_staged_buffer_alone(live_api: TestClient) -> None:
    # The pending buffer is shared with the tabs view and `POST /config/apply`
    # flushes all of it — a LIVE control must never be the thing that applies an
    # edit the user staged elsewhere.
    live_api.post("/api/config/stage", json={"http": {"title": "Opal"}})
    live_api.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert live_api.get("/api/config/pending").json()["http"] == {"title": "Opal"}


# --- matrix profiles (live lane) ------------------------------------------------


def test_matrix_profile_switch_reads_back_the_active_profile(live_api: TestClient) -> None:
    resp = live_api.post("/api/matrix/profile", json={"action": "switch", "name": "Default"})
    assert resp.json()["active"] == "Default"


# --- /config read model (form + file ⊕ live overrides + preset store) ---------


def test_config_serves_the_daemons_form_fields(wired_api: TestClient) -> None:
    fields = {f["name"]: f for f in wired_api.get("/api/config").json()["data"]["fields"]}
    assert fields["title"]["value"] == "Opal"


def test_config_file_view_prefers_the_live_engine_filter_over_the_file(wired_api: TestClient) -> None:
    # the config XML says filter=40, but State reports list index 0 = enum 0:
    # the live overlay must win, or the file view reports a setting the engine
    # stopped using
    assert wired_api.get("/api/config").json()["data"]["file"]["filter"] == "0"


def test_config_file_view_carries_file_truth_the_form_cannot(wired_api: TestClient) -> None:
    # volume_fixed is 0/1/2 in the XML but a bare checkbox on the daemon's form
    assert wired_api.get("/api/config").json()["data"]["file"]["volume_fixed"] == "1"


def test_config_profile_options_include_the_stores_presets(wired_api: TestClient) -> None:
    options = [o["value"] for o in wired_api.get("/api/config").json()["data"]["profiles"]["options"]]
    assert "Test" in options


def test_config_active_preset_is_the_stores_truth(wired_api: TestClient) -> None:
    wired_api.post("/api/profile/save", json={"name": "Mine"})
    assert wired_api.get("/api/config").json()["data"]["active"] == "Mine"


def test_preset_read_serves_the_stored_snapshot(wired_api: TestClient) -> None:
    assert wired_api.get("/api/preset/Test").json()["config"]["title"] == "Opal"


# --- /matrix read model ---------------------------------------------------------


def test_matrix_serves_the_daemons_live_profile_names(wired_api: TestClient) -> None:
    assert wired_api.get("/api/matrix").json()["data"]["live_profiles"] == ["Default", "Mch-to-Stereo mixdown"]


def test_matrix_reports_the_live_active_profile_from_state(wired_api: TestClient) -> None:
    wired_api.post("/api/matrix/profile", json={"action": "switch", "name": "Default"})
    assert wired_api.get("/api/matrix").json()["data"]["live_active"] == "Default"


def test_matrix_serves_the_config_files_saved_profiles(wired_api: TestClient) -> None:
    assert "Stock" in wired_api.get("/api/matrix").json()["data"]["file_profiles"]


def test_matrix_serves_the_forms_pipeline_rows(wired_api: TestClient) -> None:
    assert len(wired_api.get("/api/matrix").json()["data"]["rows"]) == 2


# --- /speakers read model -------------------------------------------------------


def test_speakers_read_model_serves_the_channel_labels(wired_api: TestClient) -> None:
    channels = wired_api.get("/api/speakers").json()["data"]["channels"]
    assert [ch["label"] for ch in channels] == ["Left", "Right"]


# --- static surface (no daemon involved) ----------------------------------------


def test_spa_assets_demand_revalidation(api_client: TestClient) -> None:
    assert api_client.get("/").headers["cache-control"] == "no-cache"


def test_metadata_serves_the_static_databases(api_client: TestClient) -> None:
    assert "filters" in api_client.get("/api/metadata").json()
