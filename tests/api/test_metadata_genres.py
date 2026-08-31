"""The shipped filter metadata carries genre tags.

Genre tags are joined by name against the running engine's enumeration and drive
the narrow bar's genre facet. They are read back through the loader that serves
/api/metadata, never off the JSON as text, so a database rebuilt without them is
caught the same way a caller would meet it. Which tags exist is owner-owned data
(docs/testing.md rule 9); only that some filter is tagged is pinned.
"""

from fastapi.testclient import TestClient


def _filters_carrying_any_genre(client: TestClient) -> list[str]:
    overlay = client.get("/api/metadata").json()["filters"]["filters"]
    return sorted(name for name, entry in overlay.items() if entry.get("genre"))


def test_the_shipped_filter_metadata_carries_genre_tags_at_all(api_client: TestClient) -> None:
    assert _filters_carrying_any_genre(api_client) != []
