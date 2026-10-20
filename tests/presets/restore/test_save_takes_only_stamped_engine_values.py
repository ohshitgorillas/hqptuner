"""A save stores the realized config, and only a stamped Engine reading is a source for it.

The realized config is the File with the Engine's live-domain fields written in,
and only the Engine's last verified reading since the last outcome counts. A
value that never arrived through the stamped readings path is not an Engine
reading at all: the save stores the File's value for that field.

The File here is the 8088 fake's ``/backup``. The Engine reading is taken and then
the Engine goes Down, so the reading the manager still holds is no longer the
Engine's last verified one. The Engine is on the PCM chain running a Nx filter
whose enum ID the File never holds, so a save that folds in that reading stores
that enum ID and one that does not stores the File's.
"""

from typing import Any

import pytest

from hqptuner.conf import presetconf
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

#: The preset each save writes.
SAVED = "Saved"

#: The generation the Engine reading is taken in.
GENERATION = 1

#: The PCM chain's Nx filter in the File, and two values the File may hold, neither
#: of them the enum ID the Engine runs.
FILE_FIELD = "filter"
FILE_VALUES = ["40", "61"]

#: The Engine on the PCM chain: ``State`` speaks list indices, and the filter
#: enumeration joins index ``2`` to enum ID ``25``.
ENGINE_FILTERNX_INDEX = "2"
ENGINE_FILTER_ENUM_ID = "25"
ENGINE_STATE = {
    "state": "0",
    "mode": "1",
    "filter1x": "0",
    "filterNx": ENGINE_FILTERNX_INDEX,
    "shaper": "0",
    "rate": "0",
    "volume": "-12.0",
    "adaptive": "0",
}
ENGINE_STATUS = {"state": "0", "active_mode": "PCM", "active_rate": "0"}
ENGINE_ENUMS = {
    "modes": [
        {"index": "0", "name": "[source]", "value": "0"},
        {"index": "1", "name": "PCM", "value": "1"},
        {"index": "2", "name": "SDM (DSD)", "value": "2"},
    ],
    "filters": [
        {"index": "0", "name": "none", "value": "10"},
        {"index": "1", "name": "IIR", "value": "22"},
        {"index": ENGINE_FILTERNX_INDEX, "name": "sinc-M", "value": ENGINE_FILTER_ENUM_ID},
    ],
    "shapers": [{"index": "0", "name": "none", "value": "7"}],
}


def saved_field(manager: ConnectionManager) -> str | None:
    """The Nx filter the saved preset's Record holds."""
    return presetconf.read_config(manager.presetops.store.read(SAVED)).get(FILE_FIELD)


@pytest.mark.parametrize("file_value", FILE_VALUES)
async def test_a_save_stores_the_files_value_over_an_engine_reading_taken_before_the_engine_went_down(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], file_value: str
) -> None:
    http_daemon[FILE_FIELD] = file_value
    http_manager.readings.take_engine(GENERATION, state=ENGINE_STATE, status=ENGINE_STATUS, enums=ENGINE_ENUMS)
    http_manager.readings.break_engine()
    await presetlane.save(http_manager, SAVED)
    assert saved_field(http_manager) == file_value
