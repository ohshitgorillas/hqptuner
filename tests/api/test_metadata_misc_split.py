"""The catch-all filter family the filters overlay serves last.

Two engine filter names — `none` and `ASRC` — share nothing beyond being
unrelated to every resampling family, so the overlay files them together in one
catch-all family and serves it after every other family: the entries dict's key
order IS the dropdown display order. Nothing else is filed there; `FFT` in
particular belongs to the FIR family (tests/api/test_metadata_conventional_family.py).
Every other family the overlay serves occupies its own contiguous run of that
order, and the ten named resampling filters pinned here sit outside the
catch-all.

The running engine stays the sole authority for the enumeration itself
(docs/architecture.md §2) and the overlay joins to it by raw engine name, so
raw names appear here as the wire identifiers they are. Display wording —
family labels, leaf labels, short titles — is owner-owned data: it is derived
from the payload where a test needs it and never written as a literal.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_plain_names.py.
"""

from itertools import groupby
from typing import cast

import pytest
from fastapi.testclient import TestClient

# Raw engine names, not display copy.
MISC_NAMES = ["none", "ASRC"]

NAMED_FAMILY_NAMES = [
    "IIR",
    "IIR2",
    "FIR",
    "asymFIR",
    "minphaseFIR",
    "FFT",
    "polynomial-1",
    "polynomial-2",
    "minringFIR-mp",
    "minringFIR-lp",
]

ANNOTATED_FIELDS = [(name, field) for name in MISC_NAMES + NAMED_FAMILY_NAMES for field in ("family", "leaf", "short")]


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, object]]", payload["plain_names"]["filters"]["entries"])


def _family_of(entries: dict[str, dict[str, object]], name: str) -> str:
    return cast("str", entries[name]["family"])


def _families_in_served_order(entries: dict[str, dict[str, object]]) -> list[str]:
    """Family of every entry, in the order the dropdown displays them."""
    return [_family_of(entries, name) for name in entries]


def _family_members(entries: dict[str, dict[str, object]], anchor: str) -> set[str]:
    """Every raw name the overlay files under the family the anchor is in."""
    family = _family_of(entries, anchor)
    return {name for name, entry in entries.items() if entry["family"] == family}


# --- the catch-all family ----------------------------------------------------


def test_the_catch_all_family_holds_exactly_its_two_unrelated_filters(api_client: TestClient) -> None:
    # Membership is read off the payload rather than assumed from the two names,
    # so a third row filed into the catch-all is a failure here and not an
    # invisible extra.
    entries = _filter_entries(api_client)
    assert _family_members(entries, "none") == set(MISC_NAMES)


def test_the_catch_all_family_serves_after_every_other_family(api_client: TestClient) -> None:
    # The catch-all is identified from the payload, never named: it is whatever
    # family `none` is filed under, and no entry of another family may follow it.
    entries = _filter_entries(api_client)
    served = _families_in_served_order(entries)
    catch_all = _family_of(entries, "none")
    first_seen = {family: served.index(family) for family in set(served)}
    assert first_seen[catch_all] == max(first_seen.values())


# --- the named resampling families -------------------------------------------


@pytest.mark.parametrize("name", NAMED_FAMILY_NAMES)
def test_a_named_resampling_filter_sits_outside_the_catch_all_family(api_client: TestClient, name: str) -> None:
    entries = _filter_entries(api_client)
    assert _family_of(entries, name) != _family_of(entries, "none")


# --- grouping and completeness -----------------------------------------------


def test_every_family_occupies_one_contiguous_run_of_the_display_order(api_client: TestClient) -> None:
    # Two rows of one family separated by a row of another would split the
    # family across the dropdown, so each family may open exactly one run.
    runs = [family for family, _ in groupby(_families_in_served_order(_filter_entries(api_client)))]
    assert sorted(family for family in set(runs) if runs.count(family) > 1) == []


@pytest.mark.parametrize(("name", "field"), ANNOTATED_FIELDS)
def test_a_pinned_filter_serves_a_non_empty_display_field(api_client: TestClient, name: str, field: str) -> None:
    value = _filter_entries(api_client)[name][field]
    assert isinstance(value, str) and value.strip() != ""
