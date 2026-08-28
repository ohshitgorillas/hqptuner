"""Easy Mode's static payload on `/api/metadata`.

The Easy Mode card is drawn from `hqptuner/data/easy-presets.json`, which the
static metadata loader serves whole under the `easy` key beside `filters`,
`shapers`, `settings` and `plain_names`. The frontend reads its notice and its
two preset tables from there (`store/prose.js`'s `easyProse`), so a payload that
carries no `easy` section leaves the card with nothing to say.

What is pinned here is the KEYS — `easy`, and `notice` / `album` / `playlist`
inside it — and that the notice is a non-empty string. The notice's WORDING is
owner-owned copy and is asserted nowhere (docs/testing.md rule 9): the owner may
reword it without changing a single behavior.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_blurbs.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# The two preset grids the card switches between, by the keys the file is keyed
# by — wire identifiers, contract like any other JSON key.
GRIDS = ["album", "playlist"]


def _payload(client: TestClient) -> dict[str, object]:
    return cast("dict[str, object]", client.get("/api/metadata").json())


def _easy(client: TestClient) -> dict[str, object]:
    return cast("dict[str, object]", _payload(client)["easy"])


# --- the section reaches the frontend at all ----------------------------------


def test_the_metadata_payload_carries_an_easy_section(api_client: TestClient) -> None:
    assert "easy" in _payload(api_client)


# --- and it carries the notice the card's subtitle is drawn from ---------------


def test_the_easy_section_carries_a_notice_that_says_something(api_client: TestClient) -> None:
    notice = _easy(api_client).get("notice")
    assert isinstance(notice, str) and notice.strip() != ""


# --- the notice arrives BESIDE the preset tables, not instead of them ----------
#
# The route serves the whole file, so a loader that learned to serve the notice
# and dropped what was already there fails here rather than passing above.


@pytest.mark.parametrize("grid", GRIDS)
def test_the_easy_section_still_carries_each_preset_grid(api_client: TestClient, grid: str) -> None:
    assert grid in _easy(api_client)
