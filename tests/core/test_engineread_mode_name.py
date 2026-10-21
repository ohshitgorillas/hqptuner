"""The status mode name is the name the engine's mode enumeration gives State's mode index, as the engine spells it."""

from __future__ import annotations

from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "Spectrum Analyzer", "value": "7"},
]
STATE = {"state": "0", "filter1x": "1", "filterNx": "1", "shaper": "0", "rate": "0"}
STATUS = {"state": "0", "active_mode": "PCM"}
GENERATION = 1


def _mode_name(mode_index: str) -> str:
    """Read the mode name off a bare manager whose State carries ``mode_index``."""
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.take_engine(GENERATION, state={**STATE, "mode": mode_index}, status=STATUS, enums={"modes": MODES})
    return engineread.current_mode_name(mgr)


def test_the_mode_name_is_the_engines_own_spelling_for_a_listed_mode() -> None:
    assert _mode_name("1") == "PCM"


def test_the_mode_name_is_the_engines_own_spelling_for_a_mode_no_rule_names() -> None:
    assert _mode_name("2") == "Spectrum Analyzer"


def test_the_mode_name_is_empty_at_an_index_the_enumeration_does_not_list() -> None:
    assert [_mode_name("9"), _mode_name("1")] == ["", "PCM"]
