"""PresetStore behaviour through its public API (docs/testing.md).

Pure filesystem — no daemon, no wire. Each test drives one behaviour against a
tmp_path store and asserts once."""

import json
from pathlib import Path

import pytest

from hqptuner.presetstore import PresetError, PresetStore


def _store(tmp_path: Path) -> PresetStore:
    return PresetStore(tmp_path / "presets")


def test_save_then_read_roundtrips(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Speakers", b"<hqplayerd/>")
    assert store.read("Speakers") == b"<hqplayerd/>"


def test_names_lists_saved_presets_sorted(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Office", b"<a/>")
    store.save("Speakers", b"<b/>")
    assert store.names() == ["Office", "Speakers"]


def test_names_empty_when_directory_absent(tmp_path: Path) -> None:
    assert _store(tmp_path).names() == []


def test_read_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(PresetError, match="no such preset"):
        _store(tmp_path).read("Ghost")


def test_save_overwrites_existing(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Speakers", b"<old/>")
    store.save("Speakers", b"<new/>")
    assert store.read("Speakers") == b"<new/>"


def test_delete_removes_preset(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Office", b"<a/>")
    store.delete("Office")
    assert not store.exists("Office")


def test_delete_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(PresetError, match="no such preset"):
        _store(tmp_path).delete("Ghost")


def test_active_persists_across_instances(tmp_path: Path) -> None:
    PresetStore(tmp_path / "presets").set_active("Speakers")
    assert PresetStore(tmp_path / "presets").active == "Speakers"


def test_active_is_none_by_default(tmp_path: Path) -> None:
    assert _store(tmp_path).active is None


def test_delete_active_clears_active_pointer(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Office", b"<a/>")
    store.set_active("Office")
    store.delete("Office")
    assert store.active is None


def test_invalid_name_rejected(tmp_path: Path) -> None:
    with pytest.raises(PresetError, match="invalid preset name"):
        _store(tmp_path).save("../escape", b"<a/>")


def test_active_json_is_not_a_preset(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.set_active("Speakers")
    assert store.names() == []


def test_import_missing_copies_absent_snapshots(tmp_path: Path) -> None:
    store = _store(tmp_path)
    imported = store.import_missing({"Speakers": b"<a/>", "Office": b"<b/>"})
    assert imported == ["Office", "Speakers"]


def test_import_missing_keeps_existing_preset(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Speakers", b"<mine/>")
    store.import_missing({"Speakers": b"<daemon/>"})
    assert store.read("Speakers") == b"<mine/>"


# store.json is the store's on-disk layout contract — what a DIFFERENT HQPTuner
# version reads to decide whether it understands this directory. A test writes it
# by hand for the same reason a wire test writes a frame by hand: the situation
# under test is one another version created.
def test_a_store_from_a_newer_hqptuner_is_refused(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.save("Speakers", b"<a/>")
    (tmp_path / "presets" / "store.json").write_text(json.dumps({"schema": 99}))
    with pytest.raises(PresetError, match="schema 99"):
        store.read("Speakers")


def test_an_unstamped_store_is_adopted_rather_than_refused(tmp_path: Path) -> None:
    (tmp_path / "presets").mkdir()
    (tmp_path / "presets" / "Legacy.xml").write_bytes(b"<a/>")
    assert _store(tmp_path).read("Legacy") == b"<a/>"
