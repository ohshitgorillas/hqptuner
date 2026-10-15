"""One apply staging both a profile save and a profile delete fans each out to its own targets only.

Characterization of behavior that already exists.

A preset named only by the delete loses the deleted profile and does not gain
the saved one. Stored preset XML is rendered by the fake daemon's config
renderer; readback reads profile names by the documented element shape
(hqplayerd-readme.txt §1.12), never through the writer.
"""

import json
import re

from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.core.manager import ConnectionManager

ROW = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
FILE_ROW = {"gain": "0", "mixdown": "0", "process": "", "source": "0"}

SAVED = "Crossfeed EQ"
DELETED = "Stock"
SAVE_TARGET = "Office"
DELETE_TARGET = "Den"


def staged_save_and_delete() -> dict[str, str]:
    return {
        "matrix_profile_save": json.dumps({"name": SAVED, "rows": [ROW], "presets": [SAVE_TARGET]}),
        "matrix_profile_delete": json.dumps({"name": DELETED, "presets": [DELETE_TARGET]}),
    }


def preset_holding(*profiles: str) -> bytes:
    held = {name: {"rows": [FILE_ROW], "plugins": []} for name in profiles}
    return cfg_xml(state(title="Office desk", _profiles=held))


def profile_names(xml: bytes) -> list[str]:
    return [m.decode() for m in re.findall(rb'<matrix_profile\b[^>]*name="([^"]*)"', xml)]


async def test_a_preset_targeted_only_by_the_delete_does_not_receive_the_saved_profile(
    http_manager: ConnectionManager,
) -> None:
    http_manager.presetops.store.save(SAVE_TARGET, preset_holding(DELETED))
    http_manager.presetops.store.save(DELETE_TARGET, preset_holding(DELETED))
    await http_manager.applyops.apply({}, staged_save_and_delete())
    assert SAVED not in profile_names(http_manager.presetops.store.read(DELETE_TARGET))
