"""The shipped filter metadata's genre tags are ones the narrowing facet accepts.

Genre tags are joined by name against the running engine's enumeration and drive
the narrow bar's genre facet. They are read back through the loader that serves
/api/metadata, never off the JSON as text, so a database rebuilt without them is
caught the same way a caller would meet it. Which tags exist, and whether any
filter carries one, is owner-owned data (docs/testing.md rule 9); only that every
shipped tag is one the facet's own domain admits is pinned, through the public
narrowing store rather than any list retyped here.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from hqptuner.presets.store.narrowing import NarrowingError, NarrowingStore


def _shipped_genre_tags(client: TestClient) -> set[str]:
    overlay = client.get("/api/metadata").json()["filters"]["filters"]
    return {str(tag) for entry in overlay.values() for tag in entry.get("genre") or []}


def _refused_by_facet(store: NarrowingStore, tag: str) -> bool:
    try:
        store.write({"genre": [tag]})
    except NarrowingError:
        return True
    return False


def test_every_shipped_genre_tag_is_one_the_narrowing_facet_accepts(api_client: TestClient, tmp_path: Path) -> None:
    store = NarrowingStore(tmp_path / "narrowing.json")
    offenders = sorted(tag for tag in _shipped_genre_tags(api_client) if _refused_by_facet(store, tag))
    assert offenders == []
