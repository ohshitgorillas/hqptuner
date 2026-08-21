"""The one FIR family the filters overlay splits into two variants.

Five engine filter names — `FIR`, `asymFIR`, `minphaseFIR`, `minringFIR-lp`
and `minringFIR-mp` — are filed under a single family, split into exactly two
variants: the first three share one, the last two share the other, and no other
entry in the section carries either. Inside the family the three-filter variant
serves ahead of the two-filter variant, `polynomial-1` and `polynomial-2` are
filed elsewhere and serve after all five, and the section's family order runs
`IIR`, this family, `poly-sinc-mp`, `sinc-L`, `closed-form`, `polynomial-1`,
`none` — one anchor per family, seven distinct families. The entries dict's key
order IS the dropdown display order, so ordering is read off that.

That every family occupies one contiguous run of the order is pinned by
tests/api/test_metadata_misc_split.py and is not restated here.

The running engine stays the sole authority for the enumeration itself
(docs/architecture.md §2) and the overlay joins to it by raw engine name, so
raw names appear here as the wire identifiers they are. Family and variant
labels are owner-owned display copy: every identity below is derived from the
payload — "the family of `FIR`", "the variant of `minringFIR-mp`" — and
compared to another derived value, never to a literal.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_plain_names.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

# Raw engine names, not display copy.
CONVENTIONAL = ["FIR", "asymFIR", "minphaseFIR"]
MIN_RINGING = ["minringFIR-mp", "minringFIR-lp"]
FIR_NAMES = CONVENTIONAL + MIN_RINGING

POLYNOMIALS = ["polynomial-1", "polynomial-2"]

# One raw name per family, in the order the overlay serves those families.
FAMILY_ANCHORS = ["IIR", "FIR", "poly-sinc-mp", "sinc-L", "closed-form", "polynomial-1", "none"]


def _entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, object]]", payload["plain_names"]["filters"]["entries"])


def _family_of(entries: dict[str, dict[str, object]], name: str) -> object:
    return entries[name]["family"]


def _variant_of(entries: dict[str, dict[str, object]], name: str) -> object:
    return entries[name]["variant"]


def _order(entries: dict[str, dict[str, object]]) -> dict[str, int]:
    """Position of every entry in the served (display) order."""
    return {name: i for i, name in enumerate(entries)}


# --- one family, two variants -------------------------------------------------


def test_the_five_fir_filters_share_one_family(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_family_of(entries, name)) for name in FIR_NAMES}) == 1


def test_the_fir_family_carries_exactly_two_variants(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_variant_of(entries, name)) for name in FIR_NAMES}) == 2


def test_the_three_conventional_fir_filters_share_one_variant(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_variant_of(entries, name)) for name in CONVENTIONAL}) == 1


def test_the_two_minimum_ringing_fir_filters_share_one_variant(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_variant_of(entries, name)) for name in MIN_RINGING}) == 1


@pytest.mark.parametrize("name", FIR_NAMES)
def test_an_fir_filter_carries_a_variant(api_client: TestClient, name: str) -> None:
    # Both variants of the family are real values, so no row of it falls back
    # to the family-only (null-variant) shape.
    assert _variant_of(_entries(api_client), name) is not None


def test_no_entry_outside_the_five_carries_either_fir_variant(api_client: TestClient) -> None:
    # The two variants are identified from the payload, never named: whatever
    # `FIR` and `minringFIR-mp` are filed under is theirs alone.
    entries = _entries(api_client)
    theirs = {str(_variant_of(entries, name)) for name in FIR_NAMES}
    assert [name for name in entries if name not in FIR_NAMES and str(_variant_of(entries, name)) in theirs] == []


# --- order inside the family --------------------------------------------------


def test_every_conventional_fir_row_serves_before_every_minimum_ringing_row(api_client: TestClient) -> None:
    order = _order(_entries(api_client))
    assert max(order[name] for name in CONVENTIONAL) < min(order[name] for name in MIN_RINGING)


# --- the polynomial filters sit elsewhere, and later --------------------------


@pytest.mark.parametrize("name", POLYNOMIALS)
def test_a_polynomial_filter_is_filed_outside_the_fir_family(api_client: TestClient, name: str) -> None:
    entries = _entries(api_client)
    assert _family_of(entries, name) != _family_of(entries, "FIR")


def test_both_polynomial_filters_serve_after_every_fir_row(api_client: TestClient) -> None:
    order = _order(_entries(api_client))
    assert min(order[name] for name in POLYNOMIALS) > max(order[name] for name in FIR_NAMES)


# --- family display order -----------------------------------------------------


def test_each_family_anchor_names_a_distinct_family(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_family_of(entries, name)) for name in FAMILY_ANCHORS}) == len(FAMILY_ANCHORS)


def test_the_anchored_families_serve_in_the_anchored_order(api_client: TestClient) -> None:
    # Each anchor stands for its family; the families' first appearances in the
    # served order must run in the same sequence the anchors are listed in.
    entries = _entries(api_client)
    served = [str(_family_of(entries, name)) for name in entries]
    first_seen = {family: served.index(family) for family in set(served)}
    anchored = [str(_family_of(entries, name)) for name in FAMILY_ANCHORS]
    assert sorted(anchored, key=lambda family: first_seen[family]) == anchored
