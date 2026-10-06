"""Live snapshots end to end — the LIVE view's saved combos of live settings.

Split out of ``test_api_routes`` at the file-length gate. Same shape as the rest
of that module: the app under ``TestClient`` against the threaded fake control
daemon, every case driven through the REST routes (docs/testing.md — fakes speak
the wire protocol, no manager internals are touched).
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

# A live snapshot is not a config snapshot: it holds only what the live lane can
# apply in one batch, so applying one never writes the config file and never
# restarts the daemon. Everything below goes through the routes, except the two
# cases that need a store this HQPTuner would not have written itself.


def _seed_presets(tmp_path: Path, store: dict[str, Any]) -> None:
    (tmp_path / "live-presets.json").write_text(json.dumps(store))


def test_a_saved_live_preset_holds_the_engines_current_filter(chain_api: Callable[..., TestClient]) -> None:
    # State reports the list INDEX, the preset stores the enum ID — which is what
    # the live lane translates back on apply. Index 1 is enum ID 40 on the PCM
    # chain, so a snapshot that skipped the join would store a different filter.
    client = chain_api(filterNx="1")
    assert client.put("/api/livepresets/Warm").json()["fields"]["filter"] == "40"


def test_a_saved_live_preset_labels_its_values_with_display_names(chain_api: Callable[..., TestClient]) -> None:
    # The enumerations are engine-built and can shift under a stored preset, so
    # the card shows the name saved with it rather than re-resolving the ID.
    client = chain_api(filterNx="1")
    assert client.put("/api/livepresets/Warm").json()["names"]["filter"] == "poly-sinc-gauss-long"


def test_a_saved_live_preset_records_the_loaded_chain(live_api: TestClient) -> None:
    assert live_api.put("/api/livepresets/Warm").json()["chain"] == "pcm"


@pytest.mark.parametrize(("state_mode", "saved"), [("1", "pcm"), ("2", "sdm")])
def test_a_saved_live_preset_records_the_output_mode(
    chain_api: Callable[..., TestClient], state_mode: str, saved: str
) -> None:
    # State reports the mode as a list INDEX; the preset stores the value the
    # configuration form uses, so a snapshot that skipped the join would save "1"
    # or "2" here and mean the wrong mode on a device whose list drops SDM.
    client = chain_api(mode=state_mode)
    assert client.put("/api/livepresets/Warm").json()["fields"]["mode"] == saved


def test_a_saved_live_preset_labels_the_output_mode_with_its_display_name(
    chain_api: Callable[..., TestClient],
) -> None:
    # The name comes off the engine's own modes list, not the form value: the
    # daemon calls the SDM entry "SDM (DSD)" and the card shows what it said.
    client = chain_api(mode="2")
    assert client.put("/api/livepresets/Warm").json()["names"]["mode"] == "SDM (DSD)"


def test_a_live_preset_does_not_record_the_playback_volume(live_api: TestClient) -> None:
    # Master volume stays fully transient. A preset that restored a level would
    # hand the listener a loudness jump they never asked for; it is a LIVE control
    # (POST /api/volume) and never a saved one.
    assert "volume" not in live_api.put("/api/livepresets/Warm").json()["fields"]


def test_applying_a_live_preset_lands_on_the_engine(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(filterNx="1")
    client.put("/api/livepresets/Warm")
    client.post("/api/config/live", json={"fields": {"filter": "25"}})
    client.post("/api/livepresets/Warm/apply")
    assert client.get("/api/state").json()["data"]["filterNx"] == "1"


def test_applying_a_live_preset_reports_each_setting_it_applied(live_api: TestClient) -> None:
    live_api.put("/api/livepresets/Warm")
    resp = live_api.post("/api/livepresets/Warm/apply")
    assert {"setting": "filter", "ok": True} in resp.json()["report"]["live"]


def test_a_preset_saved_on_the_other_chain_applies(chain_api: Callable[..., TestClient]) -> None:
    # Saved in SDM, applied while the engine runs PCM. Switching the engine over
    # is what applying this preset DOES, so it is never a conflict to report.
    chain_api(mode="2").put("/api/livepresets/Dark")
    assert chain_api(mode="1").post("/api/livepresets/Dark/apply").status_code == 200


def test_applying_a_preset_puts_the_engine_in_its_saved_mode(chain_api: Callable[..., TestClient]) -> None:
    # `result="OK"` is not proof a setter applied (protocol.md §4), so the engine's
    # own State is what says the mode changed. Index 2 is SDM in the modes list.
    chain_api(mode="2").put("/api/livepresets/Dark")
    client = chain_api(mode="1")
    client.post("/api/livepresets/Dark/apply")
    assert client.get("/api/state").json()["data"]["mode"] == "2"


def test_applying_a_preset_from_the_other_chain_lands_its_filter(chain_api: Callable[..., TestClient]) -> None:
    # sinc-M is enum 23 on the SDM chain and 25 on the PCM one, at index 1 and 2
    # respectively: the mode has to be written first and the rest resolved against
    # the lists it swaps in, or the stored ID lands on the wrong chain's filter.
    chain_api(mode="2", filterNx="1").put("/api/livepresets/Dark")
    client = chain_api(mode="1", filterNx="2")
    client.post("/api/livepresets/Dark/apply")
    assert client.get("/api/state").json()["data"]["filterNx"] == "1"


def test_a_listed_preset_reads_the_same_whichever_chain_the_engine_runs(
    chain_api: Callable[..., TestClient],
) -> None:
    # The list used to flag each preset against the running chain. Stated as
    # engine-independence rather than as an exact key set: a field added for
    # everyone is a benign change, a field that appears only when the engine
    # disagrees with the preset is the judgment coming back.
    chain_api(mode="2").put("/api/livepresets/Dark")
    matching = chain_api(mode="2").get("/api/livepresets").json()["presets"][0]
    mismatched = chain_api(mode="1").get("/api/livepresets").json()["presets"][0]
    assert mismatched == matching


def test_a_preset_naming_a_mode_the_device_lacks_is_refused(chain_api: Callable[..., TestClient]) -> None:
    # A DAC that cannot do DSD gets a modes list with no SDM entry, and the
    # remaining entries keep their indices — so a lane that keyed the mode off a
    # fixed position would happily apply SOME other mode here instead of refusing.
    chain_api(mode="2").put("/api/livepresets/Dark")
    resp = chain_api(mode="1", _no_sdm="1").post("/api/livepresets/Dark/apply")
    assert "mode" in resp.json()["detail"]


def test_a_live_preset_saved_in_auto_records_the_auto_mode(chain_api: Callable[..., TestClient]) -> None:
    # `[source]` is the one mode where the saved mode and the saved chain
    # disagree: the engine follows the source, so it is running the SDM chain
    # while its configured mode is auto. Both facts are the user's setup and both
    # are stored.
    client = chain_api(mode="0", _active_mode="SDM (DSD)")
    assert client.put("/api/livepresets/Follow").json()["fields"]["mode"] == "auto"


def test_applying_an_auto_preset_puts_the_engine_back_in_auto(chain_api: Callable[..., TestClient]) -> None:
    chain_api(mode="0", _active_mode="SDM (DSD)").put("/api/livepresets/Follow")
    client = chain_api(mode="1")
    client.post("/api/livepresets/Follow/apply")
    assert client.get("/api/state").json()["data"]["mode"] == "0"


# A stale value refuses the WHOLE preset, so the record seeded for these carries
# a perfectly good sibling beside the bad one: with only the stale field in it,
# a lane that applied what it could and reported the rest would pass every one of
# them. `adaptive_volume` "1" is a live setting the engine does offer, and the
# state it would have landed in is readable straight back.
_STALE = {"chain": "pcm", "fields": {"filter": "9999", "adaptive_volume": "1"}, "names": {}}


def test_a_stored_id_the_engine_no_longer_offers_names_its_field(live_api: TestClient, tmp_path: Path) -> None:
    # A filter the running enumerations no longer carry refuses the preset per
    # field, so the card can say which setting went stale.
    _seed_presets(tmp_path, {"schema": 1, "presets": {"Stale": _STALE}})
    assert "filter" in live_api.post("/api/livepresets/Stale/apply").json()["detail"]


def test_a_stale_stored_id_refuses_the_preset_outright(live_api: TestClient, tmp_path: Path) -> None:
    _seed_presets(tmp_path, {"schema": 1, "presets": {"Stale": _STALE}})
    assert live_api.post("/api/livepresets/Stale/apply").status_code == 409


def test_a_refused_preset_applies_none_of_its_good_settings(live_api: TestClient, tmp_path: Path) -> None:
    # All-or-nothing is the live lane's promise: the page has no Apply to retry
    # from, so a half-applied preset would leave the engine in a state no control
    # on it describes.
    _seed_presets(tmp_path, {"schema": 1, "presets": {"Stale": _STALE}})
    live_api.post("/api/livepresets/Stale/apply")
    assert live_api.get("/api/state").json()["data"]["adaptive"] == "0"


def test_a_store_from_a_newer_hqptuner_is_refused(live_api: TestClient, tmp_path: Path) -> None:
    # Guessing at a layout we do not understand applies settings the user never
    # chose, so a newer store is refused whole rather than read optimistically.
    _seed_presets(tmp_path, {"schema": 99, "presets": {}})
    assert live_api.get("/api/livepresets").status_code == 409


def test_an_invalid_live_preset_name_is_refused(live_api: TestClient) -> None:
    assert live_api.put("/api/livepresets/.hidden").status_code == 422


def _send(client: TestClient, methods: list[str]) -> None:
    """Send each method, in order, to the "Warm" live preset's route."""
    for method in methods:
        client.request(method, "/api/livepresets/Warm")


#: A preset saved then deleted is gone from the list; one saved again after the
#: delete is back in it.
LISTED_AFTER = [
    pytest.param(["PUT", "DELETE"], [], id="deleted"),
    pytest.param(["PUT", "DELETE", "PUT"], ["Warm"], id="saved-again"),
]


@pytest.mark.parametrize(("methods", "names"), LISTED_AFTER)
def test_the_list_carries_a_live_preset_only_while_it_is_saved(
    live_api: TestClient, methods: list[str], names: list[str]
) -> None:
    _send(live_api, methods)
    assert [p["name"] for p in live_api.get("/api/livepresets").json()["presets"]] == names


def test_a_stored_rate_is_ignored_and_the_rest_of_the_preset_applies(live_api: TestClient, tmp_path: Path) -> None:
    # Presets saved before the LIVE rate control was removed still carry a
    # "rate" field. No snapshot holds a pinned rate, so it is not applied, and it
    # must not take the rest of the preset down with it: the other settings land
    # as saved.
    record = {"chain": "pcm", "fields": {"rate": "384000", "adaptive_volume": "1"}, "names": {}}
    _seed_presets(tmp_path, {"schema": 1, "presets": {"Legacy": record}})
    live_api.post("/api/livepresets/Legacy/apply")
    assert live_api.get("/api/state").json()["data"]["adaptive"] == "1"


def test_saving_a_preset_naming_a_setting_the_lane_lacks_is_refused_naming_it(
    live_api: TestClient,
) -> None:
    # "rate" is not a snapshot setting. Dropping it silently and saving the
    # rest would leave the user believing the preset stores a rate it does not,
    # so the save is refused and the response says which key was the problem.
    resp = live_api.put("/api/livepresets/Warm", json={"fields": ["filter", "rate"]})
    assert "rate" in resp.json()["detail"]["fields"]


@pytest.mark.parametrize("field", ["junk_filter", "autopilot"])
def test_saving_a_preset_naming_the_junk_filter_or_auto_pilot_is_refused(live_api: TestClient, field: str) -> None:
    # The high-frequency filter follows the material, so no snapshot holds it or
    # the switch that drives it.
    resp = live_api.put("/api/livepresets/Warm", json={"fields": ["filter", field]})
    assert resp.json().get("code") == "fields_unknown"


def test_a_full_save_stores_every_live_setting_the_engine_reports_but_the_junk_filter(live_api: TestClient) -> None:
    fields = live_api.put("/api/livepresets/Warm").json()["fields"]
    assert set(fields) == {"mode", "filter1x", "filter", "dither", "adaptive_volume", "matrix_profile"}


#: Each snapshot surface's response keys. None carries an auto-pilot member.
SNAPSHOT_KEYS = [
    pytest.param("PUT", "/api/livepresets/Warm", {"name", "chain", "fields", "names"}, id="save"),
]


@pytest.mark.parametrize(("method", "path", "keys"), SNAPSHOT_KEYS)
def test_a_snapshot_surface_answers_with_its_settings_alone(
    live_api: TestClient, method: str, path: str, keys: set[str]
) -> None:
    assert set(live_api.request(method, path).json()) == keys


#: The engine's junk filter before the apply, and the one a schema-3 record
#: stored: the apply leaves the engine's where it was, whichever way they differ.
JUNK_HELD = [pytest.param("0", "1", id="stored-on"), pytest.param("1", "0", id="stored-off")]


@pytest.mark.parametrize(("engine", "stored"), JUNK_HELD)
def test_applying_a_schema_3_record_leaves_the_engines_junk_filter_where_it_is(
    live_api: TestClient, tmp_path: Path, engine: str, stored: str
) -> None:
    record = {"chain": "pcm", "fields": {"adaptive_volume": "1", "junk_filter": stored}, "names": {}}
    _seed_presets(tmp_path, {"schema": 3, "presets": {"Legacy": record}})
    live_api.post("/api/config/live", json={"fields": {"junk_filter": engine}})
    live_api.post("/api/livepresets/Legacy/apply")
    assert live_api.get("/api/state").json()["data"]["filter_junk"] == engine


def test_a_save_given_a_filter_value_stores_that_id_over_the_engines(live_api: TestClient) -> None:
    resp = live_api.put("/api/livepresets/Warm", json={"fields": ["filter1x"], "values": {"filter1x": "25"}})
    assert resp.json()["fields"]["filter1x"] == "25"


def test_a_save_given_a_filter_value_labels_it_with_that_items_name(live_api: TestClient) -> None:
    resp = live_api.put("/api/livepresets/Warm", json={"fields": ["filter1x"], "values": {"filter1x": "25"}})
    assert resp.json()["names"]["filter1x"] == "sinc-M"


#: An SDM preset composed while the engine runs PCM: sinc-M and ASDM7EC by their SDM enum IDs.
_SDM_SAVE = {
    "fields": ["mode", "oversampling", "modulator"],
    "values": {"mode": "sdm", "oversampling": "23", "modulator": "3"},
}


def test_a_save_given_sdm_values_while_the_engine_runs_pcm_records_the_sdm_chain(live_api: TestClient) -> None:
    assert live_api.put("/api/livepresets/Dark", json=_SDM_SAVE).json()["chain"] == "sdm"


def test_a_save_given_sdm_values_while_the_engine_runs_pcm_stores_them(live_api: TestClient) -> None:
    assert live_api.put("/api/livepresets/Dark", json=_SDM_SAVE).json()["fields"] == _SDM_SAVE["values"]


def test_a_save_given_an_adaptive_volume_value_stores_it_over_the_engines(live_api: TestClient) -> None:
    body = {"fields": ["adaptive_volume"], "values": {"adaptive_volume": "1"}}
    assert live_api.put("/api/livepresets/Warm", json=body).json()["fields"]["adaptive_volume"] == "1"


#: Values the record's chain does not enumerate: an ID no list carries, and an SDM ID
#: on a PCM record.
NOT_ENUMERATED = [
    pytest.param({"fields": ["filter1x"], "values": {"filter1x": "9999"}}, id="unknown-id"),
    pytest.param({"fields": ["filter1x"], "values": {"filter1x": "38"}}, id="sdm-id-on-pcm"),
]


@pytest.mark.parametrize("body", NOT_ENUMERATED)
def test_saving_a_value_the_records_chain_does_not_enumerate_is_refused(
    live_api: TestClient, body: dict[str, Any]
) -> None:
    assert live_api.put("/api/livepresets/Warm", json=body).json().get("code") == "values_unknown"


def test_saving_a_value_for_a_setting_the_save_does_not_name_is_refused(live_api: TestClient) -> None:
    body = {"fields": ["filter"], "values": {"filter1x": "25"}}
    assert live_api.put("/api/livepresets/Warm", json=body).json().get("code") == "values_unknown"


@pytest.mark.parametrize("value", ["2", "01"])
def test_saving_an_adaptive_volume_value_outside_the_flag_is_refused(live_api: TestClient, value: str) -> None:
    body = {"fields": ["adaptive_volume"], "values": {"adaptive_volume": value}}
    assert live_api.put("/api/livepresets/Warm", json=body).json().get("code") == "values_unknown"


def test_a_save_naming_fields_without_values_stores_the_engines_own(chain_api: Callable[..., TestClient]) -> None:
    resp = chain_api(filter1x="2").put("/api/livepresets/Warm", json={"fields": ["filter1x"]})
    assert resp.json()["fields"]["filter1x"] == "25"
