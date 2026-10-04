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


def _payload_files(root: Path) -> int:
    """How many files under ``root`` carry the payload bytes, wherever a save put them."""
    return sum(1 for path in root.rglob("*") if path.is_file() and PAYLOAD in path.read_bytes())


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


# --- listing and existence --------------------------------------------------


@pytest.mark.parametrize(
    ("saved", "listed"),
    [((), []), (("zulu", "alpha", "mike"), ["alpha", "mike", "zulu"])],
    ids=["never created", "saved"],
)
def test_names_lists_the_saved_presets_in_ascending_order(
    tmp_path: Path, saved: tuple[str, ...], listed: list[str]
) -> None:
    # with nothing saved the directory is never created, and the listing reads empty
    store = store_at(tmp_path)
    for name in saved:
        store.save(name, PAYLOAD)
    assert store.names() == listed


@pytest.mark.parametrize(("name", "expected"), [("alpha", True), ("never-saved", False)])
def test_exists_answers_for_saved_and_unsaved_names(tmp_path: Path, name: str, *, expected: bool) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    assert store.exists(name) is expected


# --- delete -----------------------------------------------------------------


@pytest.mark.parametrize(("deleted", "exists"), [("alpha", False), ("bravo", True)], ids=["itself", "another"])
def test_a_preset_exists_until_it_is_deleted(tmp_path: Path, deleted: str, *, exists: bool) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.save("bravo", PAYLOAD)
    store.delete(deleted)
    assert store.exists("alpha") is exists


def test_a_deleted_preset_leaves_the_listing(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.save("bravo", PAYLOAD)
    store.delete("alpha")
    assert store.names() == ["bravo"]


# --- name refusal -----------------------------------------------------------


@pytest.mark.parametrize(("name", "files"), [*((name, 0) for name in ESCAPING_NAMES), ("alpha", 1)])
def test_only_an_accepted_name_puts_its_payload_on_disk(tmp_path: Path, name: str, files: int) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the disk check (docs/testing.md rule 2 counts a
    # `pytest.raises` block as an assertion). A refused save may still
    # materialize the store directory and its empty stamp — that is bookkeeping,
    # not a payload, so the walk looks for the payload bytes specifically.
    store = store_at(tmp_path)
    with contextlib.suppress(PresetError):
        store.save(name, PAYLOAD)
    assert _payload_files(tmp_path) == files


@pytest.mark.parametrize(("name", "listed"), [*((name, []) for name in UNSAFE_NAMES), ("alpha", ["alpha"])])
def test_only_an_accepted_name_joins_the_listing(tmp_path: Path, name: str, listed: list[str]) -> None:
    store = store_at(tmp_path)
    with contextlib.suppress(PresetError):
        store.save(name, PAYLOAD)
    assert store.names() == listed


# --- the active pointer -----------------------------------------------------


# The pointer is written and compared under the stored name: a caller handing in
# the name with trailing whitespace points at, and clears, the same preset.
@pytest.mark.parametrize(
    ("pointed", "active"),
    [
        pytest.param(None, None, id="never-set"),
        pytest.param("alpha", "alpha", id="exact"),
        pytest.param("alpha ", "alpha", id="trailing-space"),
    ],
)
def test_the_active_pointer_survives_a_new_store_once_set(
    tmp_path: Path, pointed: str | None, active: str | None
) -> None:
    first = store_at(tmp_path)
    first.save("alpha", PAYLOAD)
    if pointed is not None:
        first.set_active(pointed)
    assert PresetStore(tmp_path / "presets").active == active


@pytest.mark.parametrize(
    ("stored", "active"),
    [
        pytest.param("alpha", "alpha", id="a-name"),
        pytest.param("", None, id="empty"),
    ],
)
def test_an_active_pointer_file_reads_as_the_name_it_holds(tmp_path: Path, stored: str, active: str | None) -> None:
    store_at(tmp_path).save("alpha", PAYLOAD)
    (tmp_path / "presets" / "active.json").write_text(json.dumps({"active": stored}))
    assert PresetStore(tmp_path / "presets").active == active


@pytest.mark.parametrize(
    ("deleted", "active"),
    [
        pytest.param("alpha", None, id="exact"),
        pytest.param("alpha ", None, id="trailing-space"),
        pytest.param("bravo", "alpha", id="another-preset"),
    ],
)
def test_deleting_the_active_preset_clears_the_active_pointer(tmp_path: Path, deleted: str, active: str | None) -> None:
    store = store_at(tmp_path)
    store.save("alpha", PAYLOAD)
    store.save("bravo", PAYLOAD)
    store.set_active("alpha")
    store.delete(deleted)
    assert store.active == active


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
