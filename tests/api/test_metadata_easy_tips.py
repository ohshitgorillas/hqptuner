"""The per-position tips Easy Mode's knobs ship with, on `/api/metadata`.

Easy Mode's card is drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key (the shape
tests/api/test_metadata_easy.py pins). Beside the tile copy that file carries a
top-level `tips` block, keyed by knob id and then by option id: one sentence per
POSITION of a knob, so that hovering a position says what that position
selects. A block that does not reach the frontend leaves every position silent.

Which knobs ship one is a fact about the shipped file, and it is the half the
frontend suite cannot see: tests/js/components/easytiles-tips.test.js seeds its
own stand-in tips, because the harness replaces the whole payload on every
reset. So the readings below are made in BOTH directions — knobs that ship
per-position copy and a knob that ships none — since a loader answering "yes"
to everything and one answering "no" to everything each pass one half.

What is pinned is PRESENCE and the KEYS, never a word (docs/testing.md rule 9).
Knob ids and option ids are wire identifiers, contract like any other JSON key;
the sentences under them are owner copy and may be reworded freely.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_easy.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# Knob-and-position pairs the shipped file gives a tip to. Every id here is one
# an existing suite already reads off the rendered card: the Source knob's three
# positions (tests/js/components/easytiles-positions.test.js), the Emphasis
# knob's resting position (tests/js/components/easytiles.test.js) and the
# Version knob's second position (tests/js/support/easytiles.js's PICK).
TIPPED = [
    ("source", "auto"),
    ("source", "standard"),
    ("source", "hires"),
    ("emphasis", "space"),
    ("version", "lifelike"),
]

# The knob whose positions carry none.
UNTIPPED = "correction"


def _tips(client: TestClient) -> dict[str, object]:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    easy = cast("dict[str, object]", payload["easy"])
    return cast("dict[str, object]", easy.get("tips", {}))


def _tip(client: TestClient, knob: str, option: str) -> str:
    positions = cast("dict[str, object]", _tips(client).get(knob, {}))
    return str(positions.get(option, "")).strip()


def test_the_easy_section_carries_a_tips_block(api_client: TestClient) -> None:
    assert "tips" in cast("dict[str, object]", cast("dict[str, object]", api_client.get("/api/metadata").json())["easy"])


@pytest.mark.parametrize(("knob", "option"), TIPPED)
def test_the_shipped_position_tip_says_something(api_client: TestClient, knob: str, option: str) -> None:
    assert _tip(api_client, knob, option) != ""


def test_the_correction_knob_ships_no_per_position_tips(api_client: TestClient) -> None:
    assert _tips(api_client).get(UNTIPPED, {}) == {}
