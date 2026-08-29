"""The copy Easy Mode's tiles ship with, and the tips their knobs do.

Easy Mode's tiles are drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key; one tile's copy lives
at `easy.<presetId>` and carries a `title` and a `description` (the shape
tests/api/test_metadata_easy.py and tests/api/test_easy_descriptions.py pin). A
tile whose entry is missing renders with nothing on it, so the entry is the
behavior.

A KNOB'S TIP rides in the same entry, under `knobs.<knobId>.tip` — the sentence
of guidance a tipped knob is described by. Only SOME knobs carry one, and which
do is a fact about the shipped file: the frontend suite renders its own stand-in
copy (tests/js/components/easytiles-tips.test.js seeds it, so that the wiring is
read without meeting a word the owner owns), which leaves nothing over there
saying that any shipped knob has a tip at all. That is what the two knob cases
below are for, and they are read in BOTH directions — a knob that ships one and
a knob that ships none — because a loader answering "yes" to everything and a
loader answering "no" to everything each pass one half.

DAMAGE CONTROL'S `material` KNOB IS NOT READ HERE. Its copy is not written yet,
so there is nothing to assert about it and nothing may be invented; what that
knob WRITES is pinned in tests/js/store/easy-damage-control.test.js and what it
offers in tests/js/components/easytiles-positions.test.js, both over wire
identifiers alone.

What is pinned throughout is PRESENCE, never a word (docs/testing.md rule 9):
the owner may reword any tile's title, its description and any knob's tip freely
and every case below stays green.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_easy.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# The tiles whose entries are read, by the ids the payload is keyed by — wire
# identifiers, keys like any other.
PRESETS = ["perfect-ten", "lifelike", "concert-hall", "purist", "old-school", "damage-control"]

# The knob that ships a tip, and the knob that ships none. Preset ids and knob
# ids are wire identifiers too, stated outright.
TIPPED = ("concert-hall", "correction")
UNTIPPED = ("purist", "emphasis")


def _entry(client: TestClient, preset: str) -> dict[str, object]:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    easy = cast("dict[str, object]", payload["easy"])
    return cast("dict[str, object]", easy.get(preset, {}))


def _tip(client: TestClient, preset: str, knob: str) -> str:
    knobs = cast("dict[str, object]", _entry(client, preset).get("knobs", {}))
    return str(cast("dict[str, object]", knobs.get(knob, {})).get("tip", "")).strip()


@pytest.mark.parametrize("preset", PRESETS)
def test_the_tile_carries_a_title_that_says_something(api_client: TestClient, preset: str) -> None:
    assert str(_entry(api_client, preset).get("title", "")).strip() != ""


@pytest.mark.parametrize("preset", PRESETS)
def test_the_tile_carries_a_description_that_says_something(api_client: TestClient, preset: str) -> None:
    assert str(_entry(api_client, preset).get("description", "")).strip() != ""


def test_the_concert_hall_correction_knob_ships_a_tip_that_says_something(api_client: TestClient) -> None:
    assert _tip(api_client, *TIPPED) != ""


def test_the_purist_emphasis_knob_ships_no_tip(api_client: TestClient) -> None:
    assert _tip(api_client, *UNTIPPED) == ""
