"""Natural-order sorting of preset names (docs/testing.md).

Preset names routinely carry a rate or a multiple in them, and those numbers
are what a reader orders the list by: a name embedding 256 belongs before one
embedding 1024, however many digits either has. Plain lexicographic ordering
gets that wrong the moment the digit counts differ, so the store offers a key
function for callers to sort through.

Pure function — no daemon, no socket, no filesystem.
"""

from hqptuner.presets.names import sort_key


def test_the_name_with_the_smaller_embedded_number_sorts_first() -> None:
    # Fed to sorted() reversed, so a key that does nothing at all fails rather
    # than passing on the order it was handed.
    assert sorted(["DSD1024", "DSD256"], key=sort_key) == ["DSD256", "DSD1024"]
