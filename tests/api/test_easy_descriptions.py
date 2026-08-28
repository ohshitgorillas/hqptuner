"""How many paragraphs each Easy Mode preset's description is written in.

The descriptions ship in the static Easy Mode payload `/api/metadata` serves
under `easy.<grid>.<presetId>.description` (the shape
tests/api/test_metadata_easy.py pins), and the card renders one block per
blank-line-separated paragraph of them — that split is pinned on the frontend
side by tests/js/components/easytiles-desc.test.js, over that suite's own
stand-in prose.

What is pinned HERE is the COUNT, never a word of the copy (docs/testing.md rule
9): the owner may reword any of these descriptions freely and every case below
stays green. The count is the behavior because it is what a tile's height is,
and a preset that grew a second paragraph makes its tile taller than the five
beside it.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_easy.py.
"""

import re
from typing import cast

import pytest
from fastapi.testclient import TestClient

# The grid the tiles under revision live on — a wire identifier, the key the
# payload is keyed by.
GRID = "album"


def _description(client: TestClient, preset: str) -> str:
    payload = cast("dict[str, object]", client.get("/api/metadata").json())
    easy = cast("dict[str, object]", payload["easy"])
    grid = cast("dict[str, object]", easy[GRID])
    tile = cast("dict[str, object]", grid[preset])
    return str(tile.get("description", ""))


def _paragraphs(text: str) -> int:
    """How many blank-line-separated paragraphs a description is written in."""
    return len([part for part in re.split(r"\n\s*\n", text) if part.strip()])


# --- the three tiles trimmed to a single paragraph -----------------------------


@pytest.mark.parametrize("preset", ["old-school", "purist", "concert-hall"])
def test_the_preset_description_is_one_paragraph(api_client: TestClient, preset: str) -> None:
    assert _paragraphs(_description(api_client, preset)) == 1


# --- and the two that keep their second one ------------------------------------
#
# A guard rather than a new claim: these two are two paragraphs today and stay
# two. What it catches is a trim applied across the grid rather than to the three
# tiles it was meant for.


@pytest.mark.parametrize("preset", ["perfect-ten", "lifelike"])
def test_the_preset_description_keeps_its_two_paragraphs(api_client: TestClient, preset: str) -> None:
    assert _paragraphs(_description(api_client, preset)) == 2
