"""The copy the playlist grid's third tile ships with.

Easy Mode's tiles are drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key; one tile's copy lives
at `easy.<grid>.<presetId>` and carries a `title` and a `description` (the shape
tests/api/test_metadata_easy.py and tests/api/test_easy_descriptions.py pin). A
tile whose entry is missing renders with nothing on it, so the entry is the
behavior.

What is pinned here is PRESENCE, never a word (docs/testing.md rule 9): the
owner may reword this tile's title and description freely and both cases below
stay green.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_easy.py.
"""

from typing import cast

from fastapi.testclient import TestClient

# The grid the tile lives on and the id it is keyed by — wire identifiers, keys
# of the payload like any other.
GRID = "playlist"
PRESET = "lossy"


def _tile(client: TestClient) -> dict[str, object]:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    easy = cast("dict[str, object]", payload["easy"])
    grid = cast("dict[str, object]", easy[GRID])
    return cast("dict[str, object]", grid.get(PRESET, {}))


def test_the_lossy_tile_carries_a_title_that_says_something(api_client: TestClient) -> None:
    assert str(_tile(api_client).get("title", "")).strip() != ""


def test_the_lossy_tile_carries_a_description_that_says_something(api_client: TestClient) -> None:
    assert str(_tile(api_client).get("description", "")).strip() != ""
