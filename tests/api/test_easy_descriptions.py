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

Every tile of the Album grid is written in one paragraph, so this file states one
number rather than a contrast between two — see the note above the cases.

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


# --- every tile of the grid is written in one paragraph -------------------------
#
# All five, since the "Switch to Hi-Res" sentence came out of Perfect Ten and
# Lifelike: the grid has no two-paragraph description left in it. So this file no
# longer holds a contrast, and nothing here can tell "one paragraph because the
# copy says so" from "one paragraph because the payload lost the split" — the
# split itself is a frontend behavior and is pinned over stand-in prose, in
# tests/js/components/easytiles-desc.test.js. What these cases are for is the
# tile heights: a description that grows a second paragraph makes its tile taller
# than the five beside it.


@pytest.mark.parametrize(
    "preset",
    ["perfect-ten", "lifelike", "concert-hall", "purist", "old-school"],
)
def test_the_preset_description_is_one_paragraph(api_client: TestClient, preset: str) -> None:
    assert _paragraphs(_description(api_client, preset)) == 1
