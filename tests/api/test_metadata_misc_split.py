"""Shape of the filter family overlay the filters dropdown is built from.

The entries dict's key order IS the dropdown display order. Which filters share
a family, which families exist and where each one sits in that order is owner
data (docs/testing.md rule 9), so nothing here names a filter or a family. What
survives is shape: every served entry carries the three display fields as
non-empty strings, and every family occupies one contiguous run of the served
order rather than being split by a row of another family.

The running engine stays the sole authority for the enumeration itself
(docs/architecture.md §2); the sweeps below iterate over whatever keys the
overlay serves rather than over a name list.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough, same as tests/api/test_metadata_plain_names.py.
"""

from itertools import groupby
from typing import cast

import pytest
from fastapi.testclient import TestClient

DISPLAY_FIELDS = ["family", "leaf", "short"]


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, object]]", payload["plain_names"]["filters"]["entries"])


def _family_of(entries: dict[str, dict[str, object]], name: str) -> str:
    return cast("str", entries[name]["family"])


def _families_in_served_order(entries: dict[str, dict[str, object]]) -> list[str]:
    """Family of every entry, in the order the dropdown displays them."""
    return [_family_of(entries, name) for name in entries]


# --- grouping ----------------------------------------------------------------


def test_every_family_occupies_one_contiguous_run_of_the_display_order(api_client: TestClient) -> None:
    # Two rows of one family separated by a row of another would split the
    # family across the dropdown, so each family may open exactly one run.
    runs = [family for family, _ in groupby(_families_in_served_order(_filter_entries(api_client)))]
    assert sorted(family for family in set(runs) if runs.count(family) > 1) == []


# --- shape of every served entry ---------------------------------------------


@pytest.mark.parametrize("field", DISPLAY_FIELDS)
def test_every_served_filter_carries_a_non_empty_display_field(api_client: TestClient, field: str) -> None:
    # Swept over every key the overlay serves, not over a name list: an entry
    # missing the field, or serving it blank, is named in the offenders list.
    entries = _filter_entries(api_client)
    offenders = [
        name
        for name, entry in entries.items()
        if not (isinstance(entry.get(field), str) and cast("str", entry[field]).strip() != "")
    ]
    assert offenders == []
