"""Family and variant blurbs on the `/api/metadata` plain-names payload.

Each `plain_names` section serves the three-key shape `{entries, families,
variants}`: `entries` is the per-name display record the frontend regroups the
dropdown by (tests/api/test_metadata_plain_names.py pins its shape), while
`families` and `variants` carry the caption text shown under the Simplified
dropdown's headers. Family blurbs key by family name, variant blurbs by the
composite `"<family>|<variant>"`. Both maps are keyed off the section's own
entries: every family present is described exactly once, every family+variant
pair present is described exactly once, and neither map carries a key no entry
uses. The dithers section's `variants` map is empty, because every dither entry
has a null variant.

The blurb wording itself is owner-owned data and no test asserts it: these
tests pin the maps' key sets against the entries and require each value to be a
non-empty string.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_genres.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

SECTIONS = ["filters", "dithers", "modulators"]
BLURB_MAPS = [(section, name) for section in SECTIONS for name in ("families", "variants")]


def _section(client: TestClient, kind: str) -> dict[str, object]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, object]", payload["plain_names"][kind])


def _entries(client: TestClient, kind: str) -> dict[str, dict[str, object]]:
    return cast("dict[str, dict[str, object]]", _section(client, kind)["entries"])


def _blurbs(client: TestClient, kind: str, map_name: str) -> dict[str, str]:
    return cast("dict[str, str]", _section(client, kind)[map_name])


def _pairs_in_entries(client: TestClient, kind: str) -> set[str]:
    return {
        f"{entry['family']}|{entry['variant']}"
        for entry in _entries(client, kind).values()
        if entry.get("variant") is not None
    }


def _families_in_entries(client: TestClient, kind: str) -> set[str]:
    return {str(entry["family"]) for entry in _entries(client, kind).values()}


# --- the three-key shape (every kind) ----------------------------------------


@pytest.mark.parametrize("kind", SECTIONS)
def test_each_plain_names_section_serves_entries_families_and_variants(api_client: TestClient, kind: str) -> None:
    assert set(_section(api_client, kind)) == {"entries", "families", "variants"}


def test_the_dithers_section_serves_an_empty_variant_blurb_map(api_client: TestClient) -> None:
    assert _section(api_client, "dithers")["variants"] == {}


def test_no_dither_entry_carries_a_variant(api_client: TestClient) -> None:
    assert _pairs_in_entries(api_client, "dithers") == set()


# --- the blurb maps are keyed off the entries --------------------------------


@pytest.mark.parametrize("kind", SECTIONS)
def test_a_sections_family_blurbs_key_exactly_the_families_its_entries_use(api_client: TestClient, kind: str) -> None:
    assert set(_blurbs(api_client, kind, "families")) == _families_in_entries(api_client, kind)


@pytest.mark.parametrize("kind", SECTIONS)
def test_a_sections_variant_blurbs_key_exactly_the_family_variant_pairs_its_entries_use(
    api_client: TestClient, kind: str
) -> None:
    assert set(_blurbs(api_client, kind, "variants")) == _pairs_in_entries(api_client, kind)


# --- every blurb says something ----------------------------------------------


@pytest.mark.parametrize(("kind", "map_name"), BLURB_MAPS)
def test_every_blurb_a_section_serves_is_a_non_empty_string(api_client: TestClient, kind: str, map_name: str) -> None:
    blurbs = _blurbs(api_client, kind, map_name)
    assert [key for key, text in blurbs.items() if not isinstance(text, str) or not text.strip()] == []
