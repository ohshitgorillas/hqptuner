"""A restore that is part of a save, with no usable working config, leaves the stored preset as it was.

Characterization of behavior that already exists.

An apply saved as a preset stores the refolded working config under that name
ahead of its restore. When the restore has no working config to fold (an
engine-lane restore hands none), or what it hands has no ``<hqplayerd>`` root,
there is nothing to store, and the preset already held keeps its bytes.
"""

from pathlib import Path

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.presetfields import preset_mirror

PRESET = "Den"
HELD = b'<hqplayerd><title value="held before the apply"/></hqplayerd>'

UNUSABLE_WORKING_XML = [
    pytest.param(None, id="no-working-xml"),
    pytest.param(b'<title value="rootless"/>', id="no-root-element"),
]


def manager_at(tmp_path: Path) -> ConnectionManager:
    cfg = Config(preset_dir=tmp_path / "presets", backup_dir=tmp_path / "backups")
    return ConnectionManager(cfg, clock=VirtualClock())


@pytest.mark.parametrize("intended", UNUSABLE_WORKING_XML)
def test_a_saving_restore_without_usable_working_xml_leaves_the_stored_preset_as_it_was(
    tmp_path: Path, intended: bytes | None
) -> None:
    manager = manager_at(tmp_path)
    manager.presetops.store.save(PRESET, HELD)
    preset_mirror(manager, intended, saving=PRESET)
    assert manager.presetops.store.read(PRESET) == HELD
