"""LivePresetStore's file handling through its public API (docs/testing.md).

Characterization of behaviour that already exists (docs/testing.md rule 8
exemption): every case here describes the store as it stands, not a change.

Live presets are HQPTuner's own state — a handful of enum ids applied through
the LIVE lane, never written to hqplayerd's config (docs/architecture.md §98) —
so nothing here needs a daemon, a socket or a port. The whole store is one JSON
file, and every one of them lands under pytest's ``tmp_path``.

A record is opaque to these tests: the store keeps whatever it was handed under
a name, so the records below are short literals rather than realistic live
settings.

The on-disk stamp (`{"schema": N, "presets": {...}}`) is the layout contract a
DIFFERENT HQPTuner version reads. A test writes a stamped file by hand for the
same reason a wire test writes a frame by hand: the situation under test is one
another version created. The number *this* build understands is never spelled
out here — it is lifted off a file this build wrote, through the public API, so
the suite tracks the build rather than restating it.
"""

import contextlib
import json
from pathlib import Path

import pytest

from hqptuner import __version__
from hqptuner.presets.store.live import LivePresetError, LivePresetSchemaError, LivePresetStore

RECORD = {"filter": 12, "shaper": 3}
OTHER_RECORD = {"filter": 7, "shaper": 1}

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = 99

#: File contents that are not our record. Each reads as empty rather than
#: raising: a corrupt file loses presets, it does not brick the page.
UNREADABLE = [
    pytest.param("not json at all {", id="not-json"),
    pytest.param("[]", id="json-array"),
    pytest.param('"alpha"', id="json-string"),
    pytest.param("{}", id="object-without-presets-key"),
    pytest.param(json.dumps({"schema": 1}), id="stamped-object-without-presets-key"),
]

#: A `schema` member that is not an integer is not a stamp at all, so it is
#: ignored rather than refused.
NON_INTEGER_SCHEMAS = [
    pytest.param("99", id="string"),
    pytest.param(99.5, id="float"),
    pytest.param(None, id="null"),
    pytest.param([99], id="list"),
]


def store_at(tmp_path: Path) -> LivePresetStore:
    return LivePresetStore(tmp_path / "live-presets.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "live-presets.json"
    path.write_text(content)
    return path


def seed_stamped(tmp_path: Path, schema: object) -> Path:
    return seed(tmp_path, json.dumps({"schema": schema, "presets": {"alpha": RECORD}}))


@pytest.fixture
def understood_schema(tmp_path_factory: pytest.TempPathFactory) -> int:
    """The stamp this build writes, taken off a file this build wrote.

    Read through the public API rather than imported, so the fixture states the
    same thing another HQPTuner version would learn by opening the file."""
    path = tmp_path_factory.mktemp("stamp") / "live-presets.json"
    LivePresetStore(path).save("alpha", RECORD)
    schema = json.loads(path.read_text())["schema"]
    assert isinstance(schema, int)
    return schema


# --- reading a store that was never written ---------------------------------


def test_a_store_whose_file_was_never_written_lists_no_presets(tmp_path: Path) -> None:
    assert LivePresetStore(tmp_path / "never-created" / "live-presets.json").names() == []


def test_a_write_creates_the_file_and_its_parent_directory(tmp_path: Path) -> None:
    store = LivePresetStore(tmp_path / "never-created" / "live-presets.json")
    store.save("alpha", RECORD)
    assert (tmp_path / "never-created" / "live-presets.json").is_file()


@pytest.mark.parametrize("content", UNREADABLE)
def test_a_file_that_is_not_our_record_lists_no_presets(tmp_path: Path, content: str) -> None:
    seed(tmp_path, content)
    assert store_at(tmp_path).names() == []


# --- names nothing is saved under -------------------------------------------


def test_reading_a_name_no_preset_is_saved_under_is_refused(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD)
    with pytest.raises(LivePresetError, match="bravo"):
        store.read("bravo")


def test_deleting_a_name_no_preset_is_saved_under_is_refused(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD)
    with pytest.raises(LivePresetError, match="bravo"):
        store.delete("bravo")


# --- the round trip ----------------------------------------------------------


def test_a_saved_preset_reads_back(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD)
    assert store.read("alpha") == RECORD


def test_saving_over_an_existing_name_replaces_that_record(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD)
    store.save("alpha", OTHER_RECORD)
    assert store.read("alpha") == OTHER_RECORD


def test_saving_over_an_existing_name_leaves_one_preset_under_it(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD)
    store.save("alpha", OTHER_RECORD)
    assert store.names() == ["alpha"]


# --- the on-disk layout stamp ------------------------------------------------


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_listing(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError):
        store_at(tmp_path).names()


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError):
        store_at(tmp_path).read("alpha")


def test_the_refusal_names_the_stamp_the_file_carries(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError, match=str(TOO_NEW)):
        store_at(tmp_path).read("alpha")


def test_the_refusal_names_this_builds_own_version(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError, match=__version__.replace(".", r"\.")):
        store_at(tmp_path).read("alpha")


def test_the_refusal_names_the_stamp_this_build_understands(tmp_path: Path, understood_schema: int) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError, match=rf"\b{understood_schema}\b"):
        store_at(tmp_path).read("alpha")


def test_the_schema_refusal_is_caught_by_a_caller_catching_the_general_error(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetError):
        store_at(tmp_path).names()


@pytest.mark.parametrize("offset", [0, -1])
def test_a_stamp_this_build_understands_is_read_rather_than_refused(
    tmp_path: Path, understood_schema: int, offset: int
) -> None:
    seed_stamped(tmp_path, understood_schema + offset)
    assert store_at(tmp_path).read("alpha") == RECORD


@pytest.mark.parametrize("schema", NON_INTEGER_SCHEMAS)
def test_a_stamp_that_is_not_a_whole_number_is_ignored_rather_than_refused(tmp_path: Path, schema: object) -> None:
    seed_stamped(tmp_path, schema)
    assert store_at(tmp_path).read("alpha") == RECORD


# --- writing into a store a newer HQPTuner stamped ---------------------------


def test_saving_into_a_file_stamped_by_a_newer_hqptuner_is_refused(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(LivePresetSchemaError):
        store_at(tmp_path).save("bravo", OTHER_RECORD)


def test_a_refused_save_leaves_the_newer_file_untouched(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the on-disk check (scripts/gates/check_test_assertions.py
    # counts a `pytest.raises` block as an assertion).
    path = seed_stamped(tmp_path, TOO_NEW)
    before = path.read_text()
    with contextlib.suppress(LivePresetError):
        store_at(tmp_path).save("bravo", OTHER_RECORD)
    assert path.read_text() == before
