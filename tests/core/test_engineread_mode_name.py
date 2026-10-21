"""The status mode name is the name the engine's mode enumeration gives State's mode index, as the engine spells it.

The name is read off one Engine view, built from an Engine reading the test writes itself, so the status route can
report the mode's name and its index from one and the same reading. The modes list runs out of index order, so a name
taken by list position reads differently from one taken by index, and Status names a mode of its own, so a name taken
from Status reads differently from one taken from the enumeration.
"""

from __future__ import annotations

from answered_reading import Answered

from hqptuner.core import engineread
from hqptuner.engine.view import EngineView
from hqptuner.fields.model import Enumeration

#: The engine's modes list, out of index order.
MODES = [
    {"index": "2", "name": "Spectrum Analyzer", "value": "7"},
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
]
STATE = {"state": "0", "filter1x": "1", "filterNx": "1", "shaper": "0", "rate": "0"}
STATUS = {"state": "0", "active_mode": "PCM"}

#: State mode indices: two the list carries, and one it does not.
PCM_INDEX = "1"
ANALYZER_INDEX = "2"
UNLISTED_INDEX = "9"


def _mode_name(mode_index: str) -> str:
    """Read the mode name off the view of a reading whose State carries ``mode_index``."""
    view = EngineView.of(Answered({**STATE, "mode": mode_index}, STATUS, {Enumeration.MODES: MODES}, None))
    return engineread.current_mode_name(view)


def _mode_name_without_modes_list(mode_index: str) -> str:
    """Read the mode name off the view of a reading whose State carries ``mode_index`` and no modes list."""
    view = EngineView.of(Answered({**STATE, "mode": mode_index}, STATUS, {}, None))
    return engineread.current_mode_name(view)


def _mode_name_without_state() -> str:
    """Read the mode name off the view of a reading that carries the modes list and no State."""
    view = EngineView.of(Answered(None, STATUS, {Enumeration.MODES: MODES}, None))
    return engineread.current_mode_name(view)


def test_the_mode_name_is_the_engines_own_spelling_for_a_listed_mode() -> None:
    assert _mode_name(PCM_INDEX) == "PCM"


def test_the_mode_name_is_the_engines_own_spelling_for_a_mode_no_rule_names() -> None:
    assert _mode_name(ANALYZER_INDEX) == "Spectrum Analyzer"


def test_the_mode_name_is_empty_at_an_index_the_enumeration_does_not_list() -> None:
    assert [_mode_name(UNLISTED_INDEX), _mode_name(PCM_INDEX)] == ["", "PCM"]


def test_the_mode_name_is_empty_when_the_reading_carries_no_modes_list() -> None:
    assert [_mode_name_without_modes_list(PCM_INDEX), _mode_name(PCM_INDEX)] == ["", "PCM"]


def test_the_mode_name_is_empty_when_the_reading_carries_no_state() -> None:
    assert [_mode_name_without_state(), _mode_name(PCM_INDEX)] == ["", "PCM"]
