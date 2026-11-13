"""Acquisition stamps belong to the payload received by a take method."""

import pytest

from hqptuner.conf.formparse import parse_matrix_form, parse_speakers_form
from hqptuner.core.readings import EngineFields, FileFields, Readings, Source, Stamp

EARLIER = 3
LATER = 8
STATE = {"state": "2", "mode": "1", "filter1x": "4"}
NEXT_STATE = {"state": "0", "mode": "1", "filter1x": "2"}
ENGINE_FIELDS: EngineFields = {
    "state": STATE,
    "status": {"state": "2", "active_rate": "96000"},
    "enums": {"filters": [{"index": "4", "name": "fixture-filter", "value": "19"}]},
    "volume_range": {"min": "-48", "max": "0"},
}
ENGINE_PAYLOADS = ("state", "status", "enums", "volume_range")
FILE_PAYLOADS = ("file_config", "engine", "config_form", "matrix_form", "speakers_form")
FORM_HTML = '<form method="post"><input name="engine" value="1"></form>'


def file_fields() -> FileFields:
    return {
        "file_config": {"filter": "19"},
        "engine": {"pipelines": "6"},
        "config_form": {"fields": [{"name": "title", "value": "fixture-title"}], "profiles": None},
        "matrix_form": parse_matrix_form(FORM_HTML),
        "speakers_form": parse_speakers_form(FORM_HTML),
    }


# Break: stamp every Engine payload with a constant generation.
@pytest.mark.parametrize("generation", [EARLIER, LATER])
@pytest.mark.parametrize("payload", ENGINE_PAYLOADS)
def test_engine_payload_keeps_its_acquisition_generation(payload: str, generation: int) -> None:
    readings = Readings()
    readings.take_engine(generation, **ENGINE_FIELDS)
    assert readings.source_stamp(Source.ENGINE, payload) == Stamp(source=Source.ENGINE, generation=generation)


# Break: assign the newest Engine generation to inputs absent from a partial read.
@pytest.mark.parametrize("payload", ["status", "enums", "volume_range"])
def test_partial_engine_read_does_not_refresh_retained_inputs(payload: str) -> None:
    readings = Readings()
    readings.take_engine(EARLIER, **ENGINE_FIELDS)
    readings.take_engine(LATER, state=NEXT_STATE)
    assert readings.source_stamp(Source.ENGINE, payload) == Stamp(source=Source.ENGINE, generation=EARLIER)


# Break: preserve an old stamp when an equal Engine payload is received again.
def test_unchanged_engine_reread_renews_its_acquisition_stamp() -> None:
    readings = Readings()
    readings.take_engine(EARLIER, state=STATE)
    readings.take_engine(LATER, state=dict(STATE))
    assert readings.source_stamp(Source.ENGINE, "state") == Stamp(source=Source.ENGINE, generation=LATER)


# Break: leave current payload stamps accessible after breaking the Engine view.
@pytest.mark.parametrize("payload", ENGINE_PAYLOADS)
def test_engine_break_invalidates_evidence_without_a_generation_change(payload: str) -> None:
    readings = Readings()
    readings.take_engine(EARLIER, **ENGINE_FIELDS)
    before = readings.source_stamp(Source.ENGINE, payload)
    readings.break_engine()
    assert readings.source_stamp(Source.ENGINE, payload) != before


# Break: use the current Engine generation instead of the File acquisition generation.
@pytest.mark.parametrize("generation", [EARLIER, LATER])
@pytest.mark.parametrize("payload", FILE_PAYLOADS)
def test_file_payload_keeps_its_own_acquisition_generation(payload: str, generation: int) -> None:
    readings = Readings()
    readings.take_file(generation=generation, **file_fields())
    readings.take_engine(LATER + 1, **ENGINE_FIELDS)
    assert readings.source_stamp(Source.FILE, payload) == Stamp(source=Source.FILE, generation=generation)


# Break: stamp every retained File payload when only one File source arrives.
@pytest.mark.parametrize("payload", ["engine", "config_form", "matrix_form", "speakers_form"])
def test_partial_file_read_does_not_refresh_other_sources(payload: str) -> None:
    readings = Readings()
    readings.take_file(generation=EARLIER, **file_fields())
    readings.take_file(generation=LATER, file_config={"filter": "23"})
    assert readings.source_stamp(Source.FILE, payload) == Stamp(source=Source.FILE, generation=EARLIER)


# Break: error or credential reports renew acquisition stamps without receiving payloads.
@pytest.mark.parametrize(
    "update",
    [
        {"config_error": "fixture-config-failure"},
        {"matrix_error": "fixture-matrix-failure"},
        {"speakers_error": "fixture-speakers-failure"},
        {"credentials_ok": False},
    ],
)
@pytest.mark.parametrize("payload", FILE_PAYLOADS)
def test_file_metadata_updates_do_not_stamp_retained_data(payload: str, update: FileFields) -> None:
    readings = Readings()
    readings.take_file(generation=EARLIER, **file_fields())
    readings.take_file(generation=LATER, **update)
    assert readings.source_stamp(Source.FILE, payload) == Stamp(source=Source.FILE, generation=EARLIER)


# Break: skip acquisition stamping when a successful reread equals the stored payload.
@pytest.mark.parametrize("payload", FILE_PAYLOADS)
def test_unchanged_file_reread_renews_its_acquisition_stamp(payload: str) -> None:
    readings = Readings()
    readings.take_file(generation=EARLIER, **file_fields())
    readings.take_file(generation=LATER, **file_fields())
    assert readings.source_stamp(Source.FILE, payload) == Stamp(source=Source.FILE, generation=LATER)


# Break: notify only on payload differences, leaving subscribers with an old acquisition stamp.
@pytest.mark.parametrize("payload", FILE_PAYLOADS)
def test_file_stamp_subscribers_hear_unchanged_successful_rereads(payload: str) -> None:
    readings = Readings()
    readings.take_file(generation=EARLIER, **file_fields())
    heard: list[Stamp | None] = []
    readings.on_change = lambda: heard.append(readings.source_stamp(Source.FILE, payload))
    readings.take_file(generation=LATER, **file_fields())
    assert Stamp(source=Source.FILE, generation=LATER) in heard


# Break: notify only when the aggregate Engine stamp changes, hiding a retained source's renewal.
@pytest.mark.parametrize(
    ("payload", "refreshed"),
    [
        ("status", {"status": ENGINE_FIELDS["status"]}),
        ("enums", {"enums": ENGINE_FIELDS["enums"]}),
        ("volume_range", {"volume_range": ENGINE_FIELDS["volume_range"]}),
    ],
)
def test_engine_subscribers_hear_retained_source_renewal_after_partial_read(
    payload: str, refreshed: EngineFields
) -> None:
    readings = Readings()
    readings.take_engine(EARLIER, **ENGINE_FIELDS)
    readings.take_engine(LATER, state=NEXT_STATE)
    heard: list[Stamp | None] = []
    readings.on_change = lambda: heard.append(readings.source_stamp(Source.ENGINE, payload))
    readings.take_engine(LATER, **refreshed)
    assert Stamp(source=Source.ENGINE, generation=LATER) in heard
