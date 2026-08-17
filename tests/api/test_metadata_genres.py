"""The genre vocabulary the shipped filter metadata is allowed to use.

Genre tags are joined by name against the running engine's enumeration and drive
the narrow bar's genre facet, so a tag the facet no longer offers is invisible
rather than loud: the filter carrying it simply stops matching every genre pick
and nothing goes red. `rock` was merged into `pop` and `blues` was retired
earlier; both are read back through the loader that serves /api/metadata, never
off the JSON as text, so a stale tag surviving a rebuild of the database is
caught the same way a caller would meet it.
"""

import pytest
from fastapi.testclient import TestClient


def _filters_carrying(client: TestClient, genre: str) -> list[str]:
    overlay = client.get("/api/metadata").json()["filters"]["filters"]
    return sorted(name for name, entry in overlay.items() if genre in (entry.get("genre") or []))


@pytest.mark.parametrize("retired", ["rock", "blues"])
def test_no_shipped_filter_carries_a_retired_genre_tag(api_client: TestClient, retired: str) -> None:
    assert _filters_carrying(api_client, retired) == []


def test_the_shipped_filter_metadata_carries_genre_tags_at_all(api_client: TestClient) -> None:
    assert _filters_carrying(api_client, "pop") != []
