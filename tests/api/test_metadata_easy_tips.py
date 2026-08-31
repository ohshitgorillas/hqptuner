"""The per-position tips Easy Mode's knobs ship with, on `/api/metadata`.

Easy Mode's card is drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key (the shape
tests/api/test_metadata_easy.py pins). Beside the tile copy that file carries a
top-level `tips` block, keyed by knob id and then by option id: one sentence per
POSITION of a knob, so that hovering a position says what that position
selects. A block that does not reach the frontend leaves every position silent.

WHICH POSITIONS A KNOB HAS IS NOT STATED HERE. The same response carries the
tile copy, and a tile's entry lists its knobs' positions at
`easy.<presetId>.knobs.<knobId>.options` — so the offer is read out of the
payload and the tips block is asked to cover every position of it. A knob
that gains a position and is not given copy for it fails here; a hand-typed
position list would not have noticed.

That the frontend WIRES those sentences to the positions is the other half, and
it is pinned in tests/js/components/easytiles-tips.test.js, which seeds its own
stand-in copy because the harness replaces the whole payload on every reset.
This file is the half no seeded case can see: that the copy ships at all.

What is pinned is PRESENCE and the KEYS, never a word (docs/testing.md rule 9).
Knob ids and option ids are wire identifiers, contract like any other JSON key;
the sentences under them are owner copy and may be reworded freely.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_easy.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# The knobs the shipped file gives per-position copy to. Knob ids are wire
# identifiers, stated outright; their POSITIONS are not, and are derived below.
TIPPED_KNOBS = ["emphasis", "version"]

# WHICH TILES the card lays out is the owner's curated list and is not stated
# here (docs/testing.md rule 9): the sweep walks every preset entry the payload
# serves, which is every key of the section beside the notice, the help panel's
# copy, the tips block, the card knob's own copy (`card`) and the file's own
# authoring comment. The `material` knob is not in TIPPED_KNOBS: it is the
# CARD's knob, one control on the card body, so no preset entry carries
# `knobs.material` and there is no per-tile position to ask a tip for. A tile
# with no knobs offers nothing for the sweep to cover.
BESIDE_THE_PRESETS = {"notice", "help", "tips", "card", "_comment"}


def _easy(client: TestClient) -> dict[str, object]:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    return cast("dict[str, object]", payload["easy"])


def _offered(client: TestClient, knob: str) -> set[str]:
    """Every position one knob offers anywhere in the card, read off the payload."""
    easy = _easy(client)
    found: set[str] = set()
    for preset, served in easy.items():
        if preset in BESIDE_THE_PRESETS:
            continue
        entry = cast("dict[str, object]", served)
        knobs = cast("dict[str, object]", entry.get("knobs", {}))
        options = cast("dict[str, object]", cast("dict[str, object]", knobs.get(knob, {})).get("options", {}))
        found |= set(options)
    return found


def _tipped(client: TestClient, knob: str) -> set[str]:
    """Every position of one knob the tips block gives a sentence with something in it."""
    tips = cast("dict[str, object]", _easy(client).get("tips", {}))
    positions = cast("dict[str, object]", tips.get(knob, {}))
    return {option for option, words in positions.items() if str(words).strip() != ""}


# The offer is compared against the coverage AND against emptiness in the one
# assertion: a knob whose positions vanished from the payload would otherwise
# have every position covered, vacuously.
@pytest.mark.parametrize("knob", TIPPED_KNOBS)
def test_every_position_the_knob_offers_ships_a_tip_that_says_something(api_client: TestClient, knob: str) -> None:
    assert _tipped(api_client, knob) == _offered(api_client, knob) != set()
