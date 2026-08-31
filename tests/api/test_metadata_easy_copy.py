"""The copy Easy Mode's tiles ship with, and the tips their knobs do.

Easy Mode's tiles are drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key; one tile's copy lives
at `easy.<presetId>` and carries a `title` and a `description` (the shape
tests/api/test_metadata_easy.py and tests/api/test_easy_descriptions.py pin). A
tile whose entry is missing renders with nothing on it, so the entry is the
behavior.

A KNOB'S TIP rides in the same entry, under `knobs.<knobId>.tip`, the sentence
of guidance a tipped knob is described by. Only SOME knobs carry one, and which
do is the owner's call: it is asserted nowhere, here or in the frontend suite
(tests/js/components/easytiles-tips.test.js seeds its own stand-in copy on every
knob, so that the wiring is read without meeting a word the owner owns).

WHICH TILES EXIST is the owner's curated list and is not stated here either
(docs/testing.md rule 9): the title and description sweeps read the preset ids
off the served payload and ask a property of every one.

The `material` knob is not read here. Its copy is not written yet,
so there is nothing to assert about it and nothing may be invented; what that
knob WRITES is pinned in tests/js/store/easy.test.js and what it
offers in tests/js/components/easytiles-positions.test.js, both over wire
identifiers alone.

What is pinned throughout is PRESENCE, never a word (docs/testing.md rule 9):
the owner may reword any tile's title, its description and any knob's tip freely
and every case below stays green.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_easy.py.
"""

from typing import cast

from fastapi.testclient import TestClient

# The keys the section carries BESIDE its preset entries: the card's notice, the
# help panel's copy, the per-position tips block, the card knob's own copy
# (`card.material`, the one control on the card body rather than on any tile)
# and the file's own authoring comment. Every other key is a preset entry.
BESIDE_THE_PRESETS = {"notice", "help", "tips", "card", "_comment"}


def _easy(client: TestClient) -> dict[str, object]:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    return cast("dict[str, object]", payload["easy"])


def _entries(client: TestClient) -> dict[str, dict[str, object]]:
    """Every preset entry the section serves, keyed by preset id."""
    return {
        preset: cast("dict[str, object]", entry)
        for preset, entry in _easy(client).items()
        if preset not in BESIDE_THE_PRESETS
    }


def _says_nothing(entry: dict[str, object], field: str) -> bool:
    return str(entry.get(field, "")).strip() == ""


# The non-empty guard for the served section lives in
# tests/api/test_metadata_easy.py
# (test_the_easy_section_carries_at_least_one_preset_entry), so these sweeps do
# not restate it.
def test_every_tile_carries_a_title_that_says_something(api_client: TestClient) -> None:
    entries = _entries(api_client)
    offenders = [preset for preset, entry in entries.items() if _says_nothing(entry, "title")]
    assert offenders == []


def test_every_tile_carries_a_description_that_says_something(api_client: TestClient) -> None:
    entries = _entries(api_client)
    offenders = [preset for preset, entry in entries.items() if _says_nothing(entry, "description")]
    assert offenders == []
