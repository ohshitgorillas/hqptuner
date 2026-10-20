"""Auto-pilot's switch and the per-preset states it records do not overwrite each other.

Characterization of behavior that already exists.

The store holds two things: whether auto-pilot is on, and the state each saved
config preset carries. Flipping the switch keeps every preset's recorded state,
and recording a preset's state (what a config preset save does) keeps the switch.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from hqptuner.presets.store.autopilot import AutopilotStore

PRESET_ON = "Den"
PRESET_OFF = "Office"


def store_at(tmp_path: Path) -> AutopilotStore:
    return AutopilotStore(tmp_path / "autopilot.json")


def recorded_states(store: AutopilotStore) -> dict[str, bool]:
    return {name: store.for_preset(name) for name in (PRESET_ON, PRESET_OFF)}


SWITCHES = [
    pytest.param(AutopilotStore.enable, id="on"),
    pytest.param(AutopilotStore.disable, id="off"),
]


@pytest.mark.parametrize("switch", SWITCHES)
def test_switching_autopilot_keeps_every_presets_recorded_state(
    tmp_path: Path, switch: Callable[[AutopilotStore], None]
) -> None:
    store = store_at(tmp_path)
    store.set_for_preset(PRESET_ON, enabled=True)
    store.set_for_preset(PRESET_OFF, enabled=False)
    switch(store)
    assert recorded_states(store_at(tmp_path)) == {PRESET_ON: True, PRESET_OFF: False}


def test_recording_a_presets_state_leaves_autopilot_switched_on(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.enable()
    store.set_for_preset(PRESET_ON, enabled=True)
    assert store_at(tmp_path).enabled is True
