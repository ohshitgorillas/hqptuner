"""PresetStore behavior through its public API (docs/testing.md).

Pure filesystem — no daemon, no socket, no HTTP. The store treats a preset
payload as opaque bytes and never parses it, so the payloads here are short
literals rather than realistic hqplayerd config XML. Every store is rooted
under pytest's ``tmp_path`` so nothing lands in the repo.
"""

import contextlib
import json
from pathlib import Path

import pytest

from hqptuner.presets.store.presets import PresetError, PresetStore

PAYLOAD = b"<hqplayerd/>"

# Payloads chosen to catch text-mode munging: CRLF that a text round-trip would
# translate, and trailing whitespace that a strip would eat.
ROUND_TRIP_PAYLOADS = [
    PAYLOAD,
    b"<hqplayerd>\r\n  <x/>\r\n</hqplayerd>\n  ",
]

# Not plain preset names: a path separator or a parent-directory hop.
UNSAFE_NAMES = ["../escape", "a/b", "..", "/etc/passwd", "nested/../../out"]

# The subset of the above that would land inside tmp_path if it were honored,
# so a stray write is observable by walking the tree.
ESCAPING_NAMES = ["../escape", "a/b", "nested/../../out"]


def store_at(tmp_path: Path) -> PresetStore:
    return PresetStore(tmp_path / "presets")


# --- save, read, overwrite --------------------------------------------------


@pytest.mark.parametrize("payload", ROUND_TRIP_PAYLOADS)
def test_saved_preset_reads_back_byte_for_byte(tmp_path: Path, payload: bytes) -> None:
    store = store_at(tmp_path)
    store.save("alpha", payload)
    assert store.read("alpha") == payload


def test_resaving_a_name_returns_the_newer_bytes(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", b"<old/>")
    store.save("alpha", b"<new/>")
    assert store.read("alpha") == b"<new/>"


def test_reading_an_unsaved_name_reports_no_such_preset(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    with pytest.raises(PresetError, match="no such preset"):
        store.read("bravo")


# --- listing and existence --------------------------------------------------


def test_names_lists_the_saved_presets_in_ascending_order(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for name in ("zulu", "alpha", "mike"):
        store.save(name, PAYLOAD)
    assert store.names() == ["alpha", "mike", "zulu"]


def test_names_is_empty_when_the_directory_was_never_created(tmp_path: Path) -> None:
    assert PresetStore(tmp_path / "never-created").names() == []


@pytest.mark.parametrize(("name", "expected"), [("alpha", True), ("never-saved", False)])
def test_exists_answers_for_saved_and_unsaved_names(tmp_path: Path, name: str, *, expected: bool) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    assert store.exists(name) is expected


# --- delete -----------------------------------------------------------------


def test_deleting_an_unsaved_name_reports_no_such_preset(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    with pytest.raises(PresetError, match="no such preset"):
        store.delete("bravo")


def test_a_deleted_preset_no_longer_exists(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.delete("alpha")
    assert store.exists("alpha") is False


def test_a_deleted_preset_leaves_the_listing(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.save("bravo", PAYLOAD)
    store.delete("alpha")
    assert store.names() == ["bravo"]


# --- name refusal -----------------------------------------------------------


@pytest.mark.parametrize("name", UNSAFE_NAMES)
def test_saving_a_name_that_is_not_plain_is_refused(tmp_path: Path, name: str) -> None:
    store = store_at(tmp_path)
    with pytest.raises(PresetError, match="invalid preset name"):
        store.save(name, PAYLOAD)


@pytest.mark.parametrize("name", ESCAPING_NAMES)
def test_a_refused_name_puts_no_payload_on_disk(tmp_path: Path, name: str) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the disk check (scripts/check_test_assertions.py counts
    # a `pytest.raises` block as an assertion). A refused save may still
    # materialize the store directory and its empty stamp — that is bookkeeping,
    # not a payload, so the walk looks for the payload bytes specifically.
    store = store_at(tmp_path)
    with contextlib.suppress(PresetError):
        store.save(name, PAYLOAD)
    assert [p for p in tmp_path.rglob("*") if p.is_file() and PAYLOAD in p.read_bytes()] == []


@pytest.mark.parametrize("name", UNSAFE_NAMES)
def test_a_refused_name_does_not_join_the_listing(tmp_path: Path, name: str) -> None:
    store = store_at(tmp_path)
    with contextlib.suppress(PresetError):
        store.save(name, PAYLOAD)
    assert store.names() == []


# --- the active pointer -----------------------------------------------------


def test_active_is_none_when_nothing_was_made_active(tmp_path: Path) -> None:
    assert store_at(tmp_path).active is None


def test_the_active_preset_survives_a_new_store_over_the_same_directory(tmp_path: Path) -> None:
    first = store_at(tmp_path)
    first.save("alpha", PAYLOAD)
    first.set_active("alpha")
    assert PresetStore(tmp_path / "presets").active == "alpha"


def test_deleting_the_active_preset_clears_the_active_pointer(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.set_active("alpha")
    store.delete("alpha")
    assert store.active is None


@pytest.mark.parametrize(("saved", "expected"), [((), []), (("bravo", "alpha"), ["alpha", "bravo"])])
def test_the_active_bookkeeping_is_not_itself_a_preset(
    tmp_path: Path, saved: tuple[str, ...], expected: list[str]
) -> None:
    store = store_at(tmp_path)
    for name in saved:
        store.save(name, PAYLOAD)
    store.set_active(saved[0] if saved else "ghost")
    assert store.names() == expected


# --- import_missing ---------------------------------------------------------


def test_import_missing_returns_the_names_it_took_sorted(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    assert store.import_missing({"zulu": b"<z/>", "alpha": b"<a/>", "mike": b"<m/>"}) == ["alpha", "mike", "zulu"]


def test_an_imported_snapshot_is_afterwards_readable(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.import_missing({"zulu": b"<z/>", "alpha": b"<a/>"})
    assert store.read("zulu") == b"<z/>"


def test_import_missing_leaves_an_existing_preset_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", b"<mine/>")
    store.import_missing({"alpha": b"<daemon/>", "bravo": b"<b/>"})
    assert store.read("alpha") == b"<mine/>"


def test_import_missing_omits_an_existing_name_from_what_it_returns(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", b"<mine/>")
    assert store.import_missing({"alpha": b"<daemon/>", "bravo": b"<b/>"}) == ["bravo"]


# --- on-disk layout version -------------------------------------------------
#
# store.json is the store's on-disk layout contract — what a DIFFERENT HQPTuner
# version reads to decide whether it understands this directory. A test writes
# it by hand for the same reason a wire test writes a frame by hand: the
# situation under test is one another version created. The presets themselves
# are built through the public API, because their on-disk naming is not part of
# any contract.


def test_a_store_stamped_by_a_newer_hqptuner_is_refused(tmp_path: Path) -> None:
    store_at(tmp_path).save("alpha", PAYLOAD)
    (tmp_path / "presets" / "store.json").write_text(json.dumps({"schema": 99}))
    with pytest.raises(PresetError, match="99"):
        PresetStore(tmp_path / "presets").read("alpha")


def test_an_unstamped_store_is_adopted_rather_than_refused(tmp_path: Path) -> None:
    store_at(tmp_path).save("alpha", PAYLOAD)
    (tmp_path / "presets" / "store.json").unlink()
    assert PresetStore(tmp_path / "presets").read("alpha") == PAYLOAD
