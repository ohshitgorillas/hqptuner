"""PresetStore behaviour through its public API (docs/testing.md).

Pure filesystem — no daemon, no wire. Each test drives one behaviour against a
tmp_path store and asserts once."""

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
