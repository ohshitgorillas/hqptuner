"""Easy Mode's static payload on `/api/metadata`.

The Easy Mode card is drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key beside `filters`,
`shapers`, `settings` and `plain_names`. The frontend reads its notice and its
preset entries from there (`store/prose.js`'s `easyProse`), so a payload that
carries no `easy` section leaves the card with nothing to say.

THE PRESETS SIT AT THE TOP LEVEL of that section, keyed by preset id: there is
one set of tiles and no grid to key them under. What is pinned here is the KEYS
`easy` and its `notice`, that the notice is a non-empty string, and that the
section carries at least one preset entry and every entry it carries is an
object. WHICH presets exist is the owner's curated list and is asserted nowhere
(docs/testing.md rule 9), as is the notice's WORDING: the owner may add a tile,
drop one or reword the notice without changing a single behavior.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_blurbs.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# The keys the section carries BESIDE its preset entries: the notice the card's
# subtitle is drawn from, the help panel's copy
# (tests/js/components/easytiles-help.test.js), the per-position tips block
# (tests/api/test_metadata_easy_tips.py), the card knob's own copy (`card`,
# the material control on the card body rather than on any tile), and the
# file's own authoring comment. Every other key is a preset entry.
BESIDE_THE_PRESETS = {"notice", "help", "tips", "card", "_comment"}


def _payload(client: TestClient) -> dict[str, object]:
    return cast("dict[str, object]", client.get("/api/metadata").json())


def _easy(client: TestClient) -> dict[str, object]:
    return cast("dict[str, object]", _payload(client)["easy"])


def _entries(client: TestClient) -> dict[str, object]:
    """The preset entries the section carries, keyed by preset id."""
    return {key: value for key, value in _easy(client).items() if key not in BESIDE_THE_PRESETS}


# --- the section reaches the frontend at all ----------------------------------


def test_the_metadata_payload_carries_an_easy_section(api_client: TestClient) -> None:
    assert "easy" in _payload(api_client)


# --- and it carries the notice the card's subtitle is drawn from ---------------


def test_the_easy_section_carries_a_notice_that_is_a_string(api_client: TestClient) -> None:
    assert isinstance(_easy(api_client).get("notice"), str)


def test_the_notice_says_something(api_client: TestClient) -> None:
    assert str(_easy(api_client).get("notice", "")).strip() != ""


# --- the notice arrives BESIDE the preset entries, not instead of them ---------
#
# The route serves the whole file, so a loader that learned to serve the notice
# and dropped what was already there fails here rather than passing above. Which
# presets are served is the owner's list: the sweep reads the keys off the
# payload and asks a property of every one, never which ones exist.


def test_the_easy_section_carries_at_least_one_preset_entry(api_client: TestClient) -> None:
    assert _entries(api_client) != {}


def test_every_preset_entry_the_easy_section_carries_is_an_object(api_client: TestClient) -> None:
    offenders = [preset for preset, entry in _entries(api_client).items() if not isinstance(entry, dict)]
    assert offenders == []


# --- and nothing of the retired grids is left in it ----------------------------
#
# The two grid blocks the presets used to be nested under, and the tile that
# lived on one of them. A payload still carrying either would be serving the card
# a set of tiles it no longer lays out.


@pytest.mark.parametrize("retired", ["album", "playlist", "lossy"])
def test_the_easy_section_carries_no_retired_key(api_client: TestClient, retired: str) -> None:
    assert retired not in _easy(api_client)
