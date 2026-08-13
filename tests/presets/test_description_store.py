"""`DescriptionStore` — the prose a user attaches to a saved matrix profile, and
the JSON file it lives in.

This file covers the store surface alone: reading, writing, blanking, what a name
and a text may be, how many profiles may carry one, what a file some other
HQPTuner version left looks like, merging a payload, and the bytes an export
produces. The two surfaces built OVER the store — the GET/PUT `/api/descriptions`
pair and the backup/restore carriage — are in
``tests/presets/test_description_routes.py``; the suite is cut there because
nothing here needs an app, a client or a daemon, and everything there needs at
least one of the three.

A description is keyed by profile NAME, the stable join key
(docs/architecture.md §2) — `<matrix_profile>` carries exactly one attribute,
`name` (hqplayerd-readme.txt §1.12), so there is nowhere in the config XML for
prose to live and the store is HQPTuner's own state. Nothing in this file touches
hqplayerd at all: a `DescriptionStore` is a file and nothing else.

Every store file lands under pytest's ``tmp_path``, never in the repo's state
dir. The on-disk layout — ``{"schema": N, "profiles": {name: {"text", "updated"}}}``
— is the contract a DIFFERENT HQPTuner version reads, so the cases about a
foreign file hand-write one, the way a wire test hand-writes a frame.
"""

import contextlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from hqptuner.presets.descriptionstore import (
    DescriptionError,
    DescriptionSchemaError,
    DescriptionStore,
)

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = {"schema": 99, "profiles": {"Living Room": {"text": "warm", "updated": "2024-01-01T00:00:00+00:00"}}}

#: Content that is not our record: not JSON at all, and JSON that is not an
#: object. All read as empty rather than raising — a corrupt store loses
#: descriptions, it does not brick the page.
UNREADABLE = ["not json at all {", "[]", '"Living Room"', "17", "null"]

#: A stamp left by an earlier write, far enough in the past that no write made
#: during a test run can land on it.
ANCIENT = "2000-01-01T00:00:00+00:00"

NAME = "Living Room"
TEXT = "Wide stereo, gentle tilt below 200 Hz."


def store_at(tmp_path: Path) -> DescriptionStore:
    return DescriptionStore(tmp_path / "descriptions.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "descriptions.json"
    path.write_text(content)
    return path


def stamped(profiles: dict[str, dict[str, str]]) -> bytes:
    """A store file as another HQPTuner would have left it."""
    return json.dumps({"schema": 1, "profiles": profiles}).encode()


def entry(text: str, updated: str = ANCIENT) -> dict[str, str]:
    return {"text": text, "updated": updated}


# --- reading a store that was never written ---------------------------------


def test_reading_a_store_with_no_file_yields_no_descriptions(tmp_path: Path) -> None:
    assert store_at(tmp_path).read() == {}


def test_reading_a_store_with_no_file_creates_nothing(tmp_path: Path) -> None:
    store_at(tmp_path).read()
    assert list(tmp_path.iterdir()) == []


def test_a_write_creates_the_file_and_its_parent_directory(tmp_path: Path) -> None:
    DescriptionStore(tmp_path / "never-created" / "descriptions.json").write(NAME, TEXT)
    assert (tmp_path / "never-created" / "descriptions.json").is_file()


# --- the round trip -----------------------------------------------------------


def test_written_text_reads_back(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    assert store.read()[NAME]["text"] == TEXT


def test_a_write_answers_with_the_whole_map_so_no_follow_up_read_is_needed(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write("Study", "near field")
    assert sorted(store.write(NAME, TEXT)) == ["Living Room", "Study"]


def test_writing_one_name_leaves_another_names_text_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write("Study", "near field")
    store.write(NAME, TEXT)
    assert store.read()["Study"]["text"] == "near field"


# --- the stamp on an entry -----------------------------------------------------


def test_a_written_entry_carries_an_instant_in_utc(tmp_path: Path) -> None:
    written = store_at(tmp_path).write(NAME, TEXT)
    assert datetime.fromisoformat(written[NAME]["updated"]).utcoffset().total_seconds() == 0  # type: ignore[union-attr]


# A stamp is the instant of THIS write, not a constant: the window is opened and
# closed around the write itself, so an entry stamped with anything fixed —
# however plausible the value — lands outside it. The floor drops the
# microseconds because a store stamping whole seconds is still stamping the
# instant of the write.
def test_a_written_entry_is_stamped_with_the_instant_of_the_write(tmp_path: Path) -> None:
    before = datetime.now(UTC).replace(microsecond=0)
    written = store_at(tmp_path).write(NAME, TEXT)
    assert before <= datetime.fromisoformat(written[NAME]["updated"]) <= datetime.now(UTC)


def test_rewriting_a_name_replaces_its_text(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    store.write(NAME, "Flat now.")
    assert store.read()[NAME]["text"] == "Flat now."


# The old stamp is hand-written rather than produced by a first `write`, so the
# case does not depend on two writes landing in different clock ticks: a store
# that keeps the stamp it found on disk fails here whatever the resolution.
def test_rewriting_a_name_replaces_the_stamp_an_earlier_write_left(tmp_path: Path) -> None:
    seed(tmp_path, stamped({NAME: entry("warm")}).decode())
    assert store_at(tmp_path).write(NAME, TEXT)[NAME]["updated"] != ANCIENT


# --- blank text removes the entry ------------------------------------------------


@pytest.mark.parametrize("blank", [pytest.param("", id="empty"), pytest.param("   \n\t ", id="whitespace-only")])
def test_writing_blank_text_removes_the_entry(tmp_path: Path, blank: str) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    store.write(NAME, blank)
    assert NAME not in store.read()


def test_removing_one_name_leaves_another_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    store.write("Study", "near field")
    store.write(NAME, "")
    assert store.read()["Study"]["text"] == "near field"


def test_blanking_a_name_that_was_never_written_is_not_refused(tmp_path: Path) -> None:
    assert store_at(tmp_path).write(NAME, "") == {}


# --- what a name may be ----------------------------------------------------------


# The refusal has to NAME the problem, so `match=` holds it to saying which of
# the two fields it is about — the wording beyond that is the store's to choose,
# but a bare "invalid input" leaves the user nothing to act on.
@pytest.mark.parametrize(
    "name",
    [
        pytest.param("", id="empty"),
        pytest.param("x" * 129, id="129-chars"),
        pytest.param("Living\x00Room", id="null-byte"),
        pytest.param("Living\nRoom", id="newline"),
        pytest.param("Living\x07Room", id="bell"),
    ],
)
def test_an_invalid_name_is_refused(tmp_path: Path, name: str) -> None:
    with pytest.raises(DescriptionError, match=r"(?i)name"):
        store_at(tmp_path).write(name, TEXT)


def test_a_name_of_exactly_128_characters_is_accepted(tmp_path: Path) -> None:
    assert "x" * 128 in store_at(tmp_path).write("x" * 128, TEXT)


def test_a_refused_name_stores_nothing(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    with contextlib.suppress(DescriptionError):
        store.write("", TEXT)
    assert store.read() == {}


# --- what text may be -------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("x" * 2001, id="2001-chars"),
        pytest.param("warm\x00room", id="null-byte"),
        pytest.param("warm\x07room", id="bell"),
        pytest.param("warm\x1broom", id="escape"),
    ],
)
def test_invalid_text_is_refused(tmp_path: Path, text: str) -> None:
    with pytest.raises(DescriptionError, match=r"(?i)(text|description)"):
        store_at(tmp_path).write(NAME, text)


def test_text_of_exactly_2000_characters_is_accepted(tmp_path: Path) -> None:
    assert store_at(tmp_path).write(NAME, "x" * 2000)[NAME]["text"] == "x" * 2000


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("first line\nsecond line", id="newline"),
        pytest.param("gain\tphase", id="tab"),
        pytest.param("two  spaces  between", id="interior-spaces"),
        pytest.param("a paragraph\n\nand another", id="blank-line-between"),
    ],
)
def test_accepted_text_survives_verbatim(tmp_path: Path, text: str) -> None:
    assert store_at(tmp_path).write(NAME, text)[NAME]["text"] == text


def test_a_refused_text_leaves_the_previous_text_in_place(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    with contextlib.suppress(DescriptionError):
        store.write(NAME, "x" * 2001)
    assert store.read()[NAME]["text"] == TEXT


# --- how many profiles may carry one -----------------------------------------------


def test_exactly_256_profiles_are_accepted(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for i in range(255):
        store.write(f"profile-{i}", "note")
    assert len(store.write("profile-255", "note")) == 256


def test_a_257th_profile_is_refused(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for i in range(256):
        store.write(f"profile-{i}", "note")
    with pytest.raises(DescriptionError):
        store.write("profile-256", "note")


# A rewrite is not a new profile: the count that matters is how many names the
# store holds, so the store staying full must not lock out an edit.
def test_rewriting_a_name_is_allowed_with_the_store_full(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for i in range(256):
        store.write(f"profile-{i}", "note")
    assert store.write("profile-0", "edited")["profile-0"]["text"] == "edited"


# --- a file this HQPTuner did not write ---------------------------------------------


@pytest.mark.parametrize("content", UNREADABLE)
def test_a_file_that_is_not_our_record_reads_as_empty(tmp_path: Path, content: str) -> None:
    seed(tmp_path, content)
    assert store_at(tmp_path).read() == {}


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(DescriptionSchemaError, match="99"):
        store_at(tmp_path).read()


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_write(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(DescriptionSchemaError, match="99"):
        store_at(tmp_path).write(NAME, TEXT)


def test_the_schema_refusal_is_caught_by_a_caller_catching_the_general_error(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(DescriptionError):
        store_at(tmp_path).read()


def test_a_refused_write_leaves_the_newer_file_untouched(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the on-disk check.
    path = seed(tmp_path, json.dumps(TOO_NEW))
    with contextlib.suppress(DescriptionError):
        store_at(tmp_path).write(NAME, TEXT)
    assert json.loads(path.read_text()) == TOO_NEW


def test_a_file_another_hqptuner_wrote_reads_back_its_text(tmp_path: Path) -> None:
    seed(tmp_path, stamped({NAME: entry("warm")}).decode())
    assert store_at(tmp_path).read()[NAME]["text"] == "warm"


# --- merging a payload ----------------------------------------------------------------


def test_merge_adds_a_name_the_store_did_not_have(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write("Study", "near field")
    assert store.merge(stamped({NAME: entry("warm")}))[NAME]["text"] == "warm"


def test_merge_keeps_a_name_the_payload_did_not_carry(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write("Study", "near field")
    assert store.merge(stamped({NAME: entry("warm")}))["Study"]["text"] == "near field"


def test_a_name_in_both_takes_the_payloads_text(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    assert store.merge(stamped({NAME: entry("from the payload")}))[NAME]["text"] == "from the payload"


def test_a_merged_payload_reads_back_off_disk(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.merge(stamped({NAME: entry("warm")}))
    assert store_at(tmp_path).read()[NAME]["text"] == "warm"


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(b"not json at all {", id="not-json"),
        pytest.param(b"[]", id="not-an-object"),
        pytest.param(b'{"schema": 1, "profiles": ["Living Room"]}', id="profiles-not-a-map"),
    ],
)
def test_a_payload_that_is_not_a_descriptions_store_is_refused(tmp_path: Path, payload: bytes) -> None:
    with pytest.raises(DescriptionError):
        store_at(tmp_path).merge(payload)


# --- one bad entry inside a readable payload ---------------------------------------------
# The envelope is what a refusal is for. An entry inside a store that reads fine
# is dropped on the way in, the way a corrupt file drops one on the way out — so
# an archive carrying one unstorable row still gives the user back every other
# description it carried, and merging it does not raise.

#: A readable descriptions store carrying one entry that cannot be stored, and
#: one good one beside it, keyed by `id`.
SPOILED = {
    "entry-not-a-map": json.dumps({"schema": 1, "profiles": {NAME: "warm", "Study": entry("near field")}}).encode(),
    "empty-name": stamped({"": entry("warm"), "Study": entry("near field")}),
}


@pytest.mark.parametrize(
    ("payload", "dropped"),
    [
        pytest.param(SPOILED["entry-not-a-map"], NAME, id="entry-not-a-map"),
        pytest.param(SPOILED["empty-name"], "", id="empty-name"),
    ],
)
def test_an_entry_that_cannot_be_stored_is_dropped_on_the_way_in(tmp_path: Path, payload: bytes, dropped: str) -> None:
    assert dropped not in store_at(tmp_path).merge(payload)


# The pair above and this one are what separates dropping the ROW from dropping
# the PAYLOAD: a merge that discarded everything passes the first alone.
@pytest.mark.parametrize(
    "payload",
    [
        pytest.param(SPOILED["entry-not-a-map"], id="entry-not-a-map"),
        pytest.param(SPOILED["empty-name"], id="empty-name"),
    ],
)
def test_the_rest_of_a_payload_merges_around_an_entry_that_cannot_be_stored(tmp_path: Path, payload: bytes) -> None:
    assert store_at(tmp_path).merge(payload)["Study"]["text"] == "near field"


def test_a_refused_merge_changes_nothing(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, TEXT)
    with contextlib.suppress(DescriptionError):
        store.merge(b"not json at all {")
    assert store.read()[NAME]["text"] == TEXT


# --- exporting the store ----------------------------------------------------------


def test_exported_bytes_merged_into_an_empty_store_reproduce_the_text(tmp_path: Path) -> None:
    source = store_at(tmp_path)
    source.write(NAME, TEXT)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert store_at(elsewhere).merge(source.export_bytes())[NAME]["text"] == TEXT


def test_exported_bytes_merged_into_an_empty_store_reproduce_every_name(tmp_path: Path) -> None:
    source = store_at(tmp_path)
    source.write(NAME, TEXT)
    source.write("Study", "near field")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert sorted(store_at(elsewhere).merge(source.export_bytes())) == ["Living Room", "Study"]


# The two cases below read the exported BYTES rather than round-tripping them
# through our own `merge`: the envelope is what a different HQPTuner version
# reads, so a store that agreed with itself on a wrong one would carry an
# archive no other version can open.
def test_exported_bytes_are_stamped_with_the_schema_a_reader_expects(tmp_path: Path) -> None:
    source = store_at(tmp_path)
    source.write(NAME, TEXT)
    assert json.loads(source.export_bytes())["schema"] == 1


def test_exported_bytes_are_the_bytes_a_write_left_on_disk(tmp_path: Path) -> None:
    source = store_at(tmp_path)
    source.write(NAME, TEXT)
    assert source.export_bytes() == (tmp_path / "descriptions.json").read_bytes()


def test_exported_bytes_carry_the_stamp_a_write_left(tmp_path: Path) -> None:
    source = store_at(tmp_path)
    written = source.write(NAME, TEXT)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    assert store_at(elsewhere).merge(source.export_bytes())[NAME]["updated"] == written[NAME]["updated"]
