"""What a restore owes the preset store, as ``presetfields`` answers it to a caller above the lanes.

A staged restore gets a ``StoreHooks``: ``persist_backup`` leaves each pass's
fresh backup on disk before the push, ``parked_members`` are the parked filter
uploads the archive carries as ``data/<name>`` members, and ``mirror`` maps the pass's intended working config to the
``data/cfgs/<name>.xml`` members that keep hqplayerd's own profile list up to
the store. An engine-attribute
restore gets the same mirror from ``preset_mirror``.

Every working config handed in here differs from every stored preset, so a
mirror that copied the working config under a preset's name is told apart from
one that carries the store's record.
"""

from pathlib import Path

import pytest
from conftest import minimal_wave
from fake_config_xml import cfg_xml
from fake_http import state
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.presetfields import preset_mirror, restore_hooks

#: The intended working config every pass hands the mirror; no preset stores it.
WORKING = cfg_xml(state(title="Working pass"))

#: Two presets, each saved with its own title and made the active one in turn.
ACTIVE_PRESETS = [
    pytest.param("Den", cfg_xml(state(title="Den record")), id="den"),
    pytest.param("Study Room", cfg_xml(state(title="Study record")), id="study-room"),
]

#: A preset that is in the store and active while a save names a new one.
HELD_NAME = "Lounge"
HELD_XML = cfg_xml(state(title="Lounge record"))

#: Names a save hands in that the store does not hold yet.
NEW_SAVE_NAMES = [
    pytest.param("Late Night", id="two-words"),
    pytest.param("Bright", id="one-word"),
]

#: Two distinct backup archives a pass could hand ``persist_backup``.
BACKUPS = [
    pytest.param(b"PK\x03\x04first-pass-archive", id="first"),
    pytest.param(b"PK\x03\x04second-pass-archive-longer", id="second"),
]

#: Two filter uploads, by the name they are parked under and their bytes.
UPLOADS = [
    pytest.param("probe.wav", minimal_wave(), id="wave"),
    pytest.param("autoeq.txt", b"Preamp: -6.4 dB", id="text"),
]


def cfgs_member(name: str) -> str:
    """The archive member hqplayerd keeps a named profile under."""
    return f"data/cfgs/{name}.xml"


def manager_at(tmp_path: Path) -> ConnectionManager:
    cfg = Config(preset_dir=tmp_path / "presets", backup_dir=tmp_path / "backups")
    return ConnectionManager(cfg, clock=VirtualClock())


def manager_with_active(tmp_path: Path, name: str, xml: bytes) -> ConnectionManager:
    """A manager whose store holds ``xml`` as ``name``, the active preset."""
    manager = manager_at(tmp_path)
    manager.presetops.store.save(name, xml)
    manager.presetops.store.set_active(name)
    return manager


def files_under(directory: Path) -> list[bytes]:
    """The contents of every file beneath ``directory``, empty when it does not exist."""
    return [path.read_bytes() for path in directory.rglob("*") if path.is_file()]


@pytest.mark.parametrize(("name", "stored"), ACTIVE_PRESETS)
def test_the_restore_mirror_carries_the_active_presets_stored_record_under_its_profile_member(
    tmp_path: Path, name: str, stored: bytes
) -> None:
    manager = manager_with_active(tmp_path, name, stored)
    mirror = restore_hooks(manager, saving=None).mirror(WORKING)
    assert mirror.get(cfgs_member(name)) == stored


@pytest.mark.parametrize("save_name", NEW_SAVE_NAMES)
def test_a_save_name_adds_exactly_its_own_profile_member_to_the_restore_mirror(tmp_path: Path, save_name: str) -> None:
    manager = manager_with_active(tmp_path, HELD_NAME, HELD_XML)
    plain = restore_hooks(manager, saving=None).mirror(WORKING)
    saving = restore_hooks(manager, saving=save_name).mirror(WORKING)
    assert set(saving) - set(plain) == {cfgs_member(save_name)}


@pytest.mark.parametrize(("name", "stored"), ACTIVE_PRESETS)
def test_the_engine_restore_mirror_carries_the_active_presets_stored_record_under_its_profile_member(
    tmp_path: Path, name: str, stored: bytes
) -> None:
    manager = manager_with_active(tmp_path, name, stored)
    assert preset_mirror(manager).get(cfgs_member(name)) == stored


@pytest.mark.parametrize("backup", BACKUPS)
def test_persist_backup_leaves_the_passs_backup_on_disk_under_the_backup_directory(
    tmp_path: Path, backup: bytes
) -> None:
    manager = manager_at(tmp_path)
    restore_hooks(manager, saving=None).persist_backup(backup)
    assert backup in files_under(tmp_path / "backups")


@pytest.mark.parametrize(("name", "body"), UPLOADS)
def test_parked_members_carry_each_parked_upload_as_a_data_member(tmp_path: Path, name: str, body: bytes) -> None:
    manager = manager_at(tmp_path)
    parked = manager.presetops.park_filter(name, body)["name"]
    assert restore_hooks(manager, saving=None).parked_members() == {f"data/{parked}": body}
