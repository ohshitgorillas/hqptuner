"""Staged display values and write payloads share destination-aware reconciliation."""

import io
import zipfile
from collections.abc import Callable
from typing import Any

import pytest
from apps import app_manager
from fake_config_xml import elem_attr
from fastapi.testclient import TestClient

from hqptuner.core.pending import PendingSnapshot, PendingStore, clean_pending, pending_fields
from hqptuner.core.readings import Readings
from hqptuner.engine.view import EngineView

GENERATION = 4
FIRST_INDEX = "0"
SECOND_INDEX = "1"
FIRST_ID = "31"
SECOND_ID = "47"
PCM_MODE = "2"
ENUMERATIONS = {
    "modes": [
        {"index": "0", "name": "SDM (DSD)", "value": "1"},
        {"index": "1", "name": "[source]", "value": "-1"},
        {"index": PCM_MODE, "name": "PCM", "value": "0"},
    ],
    "filters": [
        {"index": FIRST_INDEX, "name": "fixture-first", "value": FIRST_ID},
        {"index": SECOND_INDEX, "name": "fixture-second", "value": SECOND_ID},
    ],
}
STATE = {"mode": PCM_MODE, "filter1x": FIRST_INDEX, "filterNx": SECOND_INDEX}
FILE_TITLE = "fixture-title"
NEW_TITLE = "fixture-renamed"


def readings_of() -> Readings:
    readings = Readings()
    readings.take_engine(GENERATION, state=STATE, enums=ENUMERATIONS)
    readings.take_file(
        generation=GENERATION,
        file_config={"title": FILE_TITLE, "filter": FIRST_ID, "oversampling": FIRST_ID},
    )
    return readings


# Break: expose HTTP enum IDs directly to an Engine-index picker.
@pytest.mark.parametrize(("value", "expected"), [(FIRST_ID, FIRST_INDEX), (SECOND_ID, SECOND_INDEX)])
def test_http_staged_enum_is_projected_into_the_shown_engine_domain(value: str, expected: str) -> None:
    pending = PendingSnapshot(live={}, http={"filter": value})
    projected = pending_fields(pending, EngineView.of(readings_of()))
    assert projected.get("filter") == expected


# Break: convert the stored HTTP write payload while projecting its display value.
@pytest.mark.parametrize("value", [FIRST_ID, SECOND_ID])
def test_projection_preserves_the_http_write_payload(value: str) -> None:
    pending = PendingSnapshot(live={}, http={"filter": value})
    pending_fields(pending, EngineView.of(readings_of()))
    assert pending.http.get("filter") == value


# Break: project an off-chain enum through the currently loaded chain's table.
@pytest.mark.parametrize("value", [FIRST_ID, SECOND_ID])
def test_off_chain_staged_value_stays_in_the_file_domain(value: str) -> None:
    pending = PendingSnapshot(live={}, http={"oversampling": value})
    projected = pending_fields(pending, EngineView.of(readings_of()))
    assert projected.get("oversampling") == value


# Break: assign both filter setter arguments to the Nx field or to both chains.
@pytest.mark.parametrize(("field", "expected"), [("filter", SECOND_INDEX), ("filter1x", FIRST_INDEX)])
def test_live_setter_arguments_project_to_their_registered_fields(field: str, expected: str) -> None:
    pending = PendingSnapshot(live={"filter": {"value": SECOND_INDEX, "value1x": FIRST_INDEX}}, http={})
    projected = pending_fields(pending, EngineView.of(readings_of()))
    assert projected.get(field) == expected


# Break: drop every HTTP edit, or keep a title already held by its destination.
@pytest.mark.parametrize(("title", "expected"), [(FILE_TITLE, None), (NEW_TITLE, NEW_TITLE)])
def test_restart_edit_is_clean_only_when_the_file_already_holds_it(title: str, expected: str | None) -> None:
    pending = PendingSnapshot(live={}, http={"title": title})
    cleaned = clean_pending(pending, readings_of())
    assert cleaned.http.get("title") == expected


# Break: compare the live index against the disagreeing File enum ID.
@pytest.mark.parametrize(("index", "expected"), [(SECOND_INDEX, None), (FIRST_INDEX, FIRST_INDEX)])
def test_live_edit_is_reconciled_against_engine_indices(index: str, expected: str | None) -> None:
    pending = PendingSnapshot(live={"filter": {"value": index}}, http={})
    cleaned = clean_pending(pending, readings_of())
    assert cleaned.live.get("filter", {}).get("value") == expected


# Break: use the active Engine chain to reconcile an off-chain File edit.
@pytest.mark.parametrize(("value", "expected"), [(FIRST_ID, None), (SECOND_ID, SECOND_ID)])
def test_off_chain_edit_is_reconciled_against_file_enum_ids(value: str, expected: str | None) -> None:
    pending = PendingSnapshot(live={}, http={"oversampling": value})
    cleaned = clean_pending(pending, readings_of())
    assert cleaned.http.get("oversampling") == expected


# Break: reconciliation mutates the caller's snapshot as it removes clean edits.
@pytest.mark.parametrize("field", ["title", "oversampling"])
def test_reconciliation_keeps_the_original_write_snapshot(field: str) -> None:
    values = {"title": FILE_TITLE, "oversampling": FIRST_ID}
    pending = PendingSnapshot(live={}, http={field: values[field]})
    clean_pending(pending, readings_of())
    assert pending.http.get(field) == values[field]


# Break: a later HTTP edit leaves an older live edit for the same field to apply.
@pytest.mark.parametrize(("field", "argument"), [("filter", "value"), ("filter1x", "value1x")])
def test_new_http_edit_replaces_the_older_live_edit(field: str, argument: str) -> None:
    store = PendingStore()
    store.stage(live={"filter": {argument: FIRST_INDEX}}, http={})
    store.stage(live={}, http={field: SECOND_ID})
    snapshot = store.snapshot()
    assert (snapshot.http.get(field), snapshot.live.get("filter", {}).get(argument)) == (SECOND_ID, None)


# Break: a later live edit leaves an older HTTP edit for the same field to apply.
@pytest.mark.parametrize(("field", "argument"), [("filter", "value"), ("filter1x", "value1x")])
def test_new_live_edit_replaces_the_older_http_edit(field: str, argument: str) -> None:
    store = PendingStore()
    store.stage(live={}, http={field: FIRST_ID})
    store.stage(live={"filter": {argument: SECOND_INDEX}}, http={})
    snapshot = store.snapshot()
    assert (snapshot.live.get("filter", {}).get(argument), snapshot.http.get(field)) == (SECOND_INDEX, None)


# Break: replacing one filter field erases the other argument's staged edit.
@pytest.mark.parametrize(("field", "kept"), [("filter", "value1x"), ("filter1x", "value")])
def test_replacing_one_field_preserves_the_other_setter_argument(field: str, kept: str) -> None:
    store = PendingStore()
    store.stage(live={"filter": {"value": FIRST_INDEX, "value1x": SECOND_INDEX}}, http={})
    store.stage(live={}, http={field: SECOND_ID})
    expected = {"value": FIRST_INDEX, "value1x": SECOND_INDEX}
    assert store.snapshot().live.get("filter", {}).get(kept) == expected[kept]


# Break: the stage response serializes the raw bucket without destination reconciliation.
@pytest.mark.parametrize(("title", "expected"), [(FILE_TITLE, None), (NEW_TITLE, NEW_TITLE)])
def test_stage_response_reconciles_the_edit_with_its_file_destination(
    api_client: TestClient, title: str, expected: str | None
) -> None:
    app_manager(api_client).readings.take_file(generation=GENERATION, file_config={"title": FILE_TITLE})
    response = api_client.post("/api/config/stage", json={"http": {"title": title}})
    assert response.json()["http"].get("title") == expected


# Break: a recovered pending response reuses cleanliness from staging before a fresh File read.
@pytest.mark.parametrize(("title", "expected"), [(FILE_TITLE, None), (NEW_TITLE, NEW_TITLE)])
def test_recovered_pending_response_reconciles_against_the_latest_file_reading(
    api_client: TestClient, title: str, expected: str | None
) -> None:
    api_client.post("/api/config/stage", json={"http": {"title": title}})
    app_manager(api_client).readings.take_file(generation=GENERATION, file_config={"title": FILE_TITLE})
    response = api_client.get("/api/config/pending")
    assert response.json()["http"].get("title") == expected


# Break: live setter ownership erases the inactive chain's distinct HTTP edit.
@pytest.mark.parametrize(
    ("mode", "off_chain", "argument", "staged"),
    [
        (PCM_MODE, "oversampling", "value", FIRST_ID),
        (PCM_MODE, "oversampling1x", "value1x", SECOND_ID),
        ("0", "filter", "value", SECOND_ID),
        ("0", "filter1x", "value1x", FIRST_ID),
    ],
)
def test_live_edit_keeps_the_other_chains_staged_file_edit(
    api_client: TestClient, mode: str, off_chain: str, argument: str, staged: str
) -> None:
    readings = app_manager(api_client).readings
    readings.take_engine(
        GENERATION,
        state={**STATE, "mode": mode, "filter1x": FIRST_INDEX, "filterNx": FIRST_INDEX},
        enums=ENUMERATIONS,
    )
    api_client.post("/api/config/stage", json={"http": {off_chain: staged}})
    response = api_client.post("/api/config/stage", json={"live": {"filter": {argument: SECOND_INDEX}}})
    assert response.json()["http"].get(off_chain) == staged


# Break: cleaning a matching 1x argument makes the remaining Nx write change both halves.
@pytest.mark.parametrize(("kept_1x", "new_nx"), [("0", "2"), ("1", "3")])
def test_applying_a_staged_filter_pair_preserves_its_explicit_unchanged_half(
    chain_api: Callable[..., TestClient], kept_1x: str, new_nx: str
) -> None:
    client = chain_api(mode="1", filter1x=kept_1x, filterNx="0")
    client.post("/api/config/stage", json={"live": {"filter": {"value": new_nx, "value1x": kept_1x}}})
    client.post("/api/config/apply")
    assert client.get("/api/state").json()["data"]["filter1x"] == kept_1x


# Break: dropping a File-equal explicit edit lets the Engine carry replace it during restore.
@pytest.mark.parametrize(("file_id", "engine_index"), [(FIRST_ID, SECOND_INDEX), (SECOND_ID, FIRST_INDEX)])
def test_restore_keeps_the_explicit_file_equal_filter_over_the_engine_carry(
    http_client: TestClient, http_daemon: dict[str, Any], file_id: str, engine_index: str
) -> None:
    http_daemon["filter"] = file_id
    readings = app_manager(http_client).readings
    readings.take_file(generation=GENERATION, file_config={"filter": file_id, "title": FILE_TITLE})
    readings.take_engine(GENERATION, state={**STATE, "filterNx": engine_index}, enums=ENUMERATIONS)
    http_client.post("/api/config/stage", json={"http": {"filter": file_id, "title": NEW_TITLE}})
    http_client.post("/api/config/apply")
    with zipfile.ZipFile(io.BytesIO(http_daemon["_restore_bytes"])) as archive:
        restored = archive.read("hqplayerd.xml")
    assert elem_attr(restored, "pcm", "filter") == file_id


MODE_SWITCHES = [("1", "sdm", "2", "oversampling"), ("2", "pcm", "1", "filter")]
SHARED_FILTER_ID = "57"


# Break: pre-switch fallback to File cleanliness hides a mode that Apply will change live.
@pytest.mark.parametrize(("initial", "target", "field"), [("1", "sdm", "oversampling"), ("2", "pcm", "filter")])
def test_mode_first_batch_shows_the_mode_that_its_engine_destination_has_not_taken(
    chain_api: Callable[..., TestClient], initial: str, target: str, field: str
) -> None:
    client = chain_api(mode=initial)
    app_manager(client).readings.take_file(generation=GENERATION, file_config={"mode": target})
    response = client.post("/api/config/stage", json={"http": {"mode": target, field: SHARED_FILTER_ID}})
    assert response.json()["http"].get("mode") == target


# Break: destructive File-domain cleanup removes the mode before Apply can switch and re-enumerate.
@pytest.mark.parametrize(("initial", "target", "target_index", "field"), MODE_SWITCHES)
def test_mode_first_batch_applies_the_requested_mode_before_its_chain_field(
    chain_api: Callable[..., TestClient], initial: str, target: str, target_index: str, field: str
) -> None:
    client = chain_api(mode=initial)
    app_manager(client).readings.take_file(generation=GENERATION, file_config={"mode": target})
    client.post("/api/config/stage", json={"http": {"mode": target, field: SHARED_FILTER_ID}})
    client.post("/api/config/apply")
    assert client.get("/api/state").json()["data"]["mode"] == target_index


# Break: retaining a paired write payload also marks its already-held half as dirty.
@pytest.mark.parametrize(("staged_1x", "expected"), [("0", None), ("1", "1")])
def test_staged_pair_response_hides_the_half_its_engine_already_holds(
    chain_api: Callable[..., TestClient], staged_1x: str, expected: str | None
) -> None:
    client = chain_api(mode="1", filter1x="0", filterNx="0")
    response = client.post("/api/config/stage", json={"live": {"filter": {"value": "2", "value1x": staged_1x}}})
    assert response.json()["live"].get("filter", {}).get("value1x") == expected


# Break: retaining a restore override exposes a File-equal field as a dirty edit.
@pytest.mark.parametrize(("staged", "expected"), [(FIRST_ID, None), (SECOND_ID, SECOND_ID)])
def test_restore_batch_response_hides_the_filter_its_file_already_holds(
    api_client: TestClient, staged: str, expected: str | None
) -> None:
    readings = app_manager(api_client).readings
    readings.take_file(generation=GENERATION, file_config={"filter": FIRST_ID, "title": FILE_TITLE})
    readings.take_engine(GENERATION, state=STATE, enums=ENUMERATIONS)
    response = api_client.post("/api/config/stage", json={"http": {"filter": staged, "title": NEW_TITLE}})
    assert response.json()["http"].get("filter") == expected


# Break: an already-current staged mode makes its live companion compare against File.
@pytest.mark.parametrize(
    ("mode", "token", "field", "current", "staged", "expected"),
    [
        (PCM_MODE, "pcm", "filter", SECOND_INDEX, FIRST_ID, FIRST_ID),
        (PCM_MODE, "pcm", "filter", FIRST_INDEX, FIRST_ID, None),
        ("0", "sdm", "oversampling", FIRST_INDEX, SECOND_ID, SECOND_ID),
        ("0", "sdm", "oversampling", SECOND_INDEX, SECOND_ID, None),
    ],
)
def test_current_mode_companion_is_clean_only_when_its_engine_destination_holds_it(
    *, mode: str, token: str, field: str, current: str, staged: str, expected: str | None
) -> None:
    readings = Readings()
    readings.take_engine(GENERATION, state={**STATE, "mode": mode, "filterNx": current}, enums=ENUMERATIONS)
    readings.take_file(generation=GENERATION, file_config={"mode": token, field: staged})
    pending = PendingSnapshot(live={}, http={"mode": token, field: staged})
    cleaned = clean_pending(pending, readings)
    assert cleaned.http.get(field) == expected


# Break: File equality drops an edit before the requested mode provides its Engine reading.
@pytest.mark.parametrize(
    ("initial", "target", "field", "staged"),
    [(PCM_MODE, "sdm", "oversampling", FIRST_ID), ("0", "pcm", "filter", SECOND_ID)],
)
def test_switching_mode_keeps_companion_until_its_destination_engine_reading_exists(
    initial: str, target: str, field: str, staged: str
) -> None:
    readings = Readings()
    readings.take_engine(GENERATION, state={**STATE, "mode": initial}, enums=ENUMERATIONS)
    readings.take_file(generation=GENERATION, file_config={"mode": target, field: staged})
    pending = PendingSnapshot(live={}, http={"mode": target, field: staged})
    cleaned = clean_pending(pending, readings)
    assert cleaned.http.get(field) == staged
