"""Natural-order sorting of preset names (docs/testing.md).

Preset names routinely carry a rate or a multiple in them, and those numbers
are what a reader orders the list by: a name embedding 256 belongs before one
embedding 1024, however many digits either has. Plain lexicographic ordering
gets that wrong the moment the digit counts differ, so the store offers a key
function for callers to sort through.

Pure function — no daemon, no socket, no filesystem.
"""

import pytest

from hqptuner.presets.names import sort_key

# Pairs written smaller-number-first: the embedded numbers differ in digit
# count, which is the case a plain sort gets wrong. Each is fed to sorted()
# reversed, so a key that does nothing at all fails rather than passes on the
# order it was handed.
ASCENDING_PAIRS = [
    pytest.param("DSD256", "DSD1024", id="dsd-rate-multiple"),
    pytest.param("Room 2", "Room 10", id="trailing-count"),
    pytest.param("48k mix", "384k mix", id="leading-number"),
]


@pytest.mark.parametrize(("smaller", "larger"), ASCENDING_PAIRS)
def test_the_name_with_the_smaller_embedded_number_sorts_first(smaller: str, larger: str) -> None:
    assert sorted([larger, smaller], key=sort_key) == [smaller, larger]
