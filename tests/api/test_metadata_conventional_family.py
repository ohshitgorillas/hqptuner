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

Family and variant memberships are derived from the payload rather than from
the five names above, so a sixth row filed into the family, or into either
variant, is a failure here and not an invisible extra.

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


def _family_members(entries: dict[str, dict[str, object]], anchor: str) -> set[str]:
    """Every raw name the overlay files under the family the anchor is in."""
    family = _family_of(entries, anchor)
    return {name for name, entry in entries.items() if entry["family"] == family}


def _variant_members(entries: dict[str, dict[str, object]], anchor: str) -> set[str]:
    """Every raw name the overlay files under the variant the anchor is in."""
    variant = _variant_of(entries, anchor)
    return {name for name, entry in entries.items() if entry["variant"] == variant}


# --- one family, two variants -------------------------------------------------


def test_the_five_fir_filters_share_one_family(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_family_of(entries, name)) for name in FIR_NAMES}) == 1


def test_the_fir_family_carries_exactly_two_variants(api_client: TestClient) -> None:
    # The family's membership is read off the payload, not assumed from the
    # five names below: a sixth row filed into it under a third variant is a
    # violation this test has to see.
    entries = _entries(api_client)
    assert len({str(_variant_of(entries, name)) for name in _family_members(entries, "FIR")}) == 2


def test_the_conventional_fir_variant_holds_exactly_its_three_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "FIR") == set(CONVENTIONAL)


def test_the_minimum_ringing_fir_variant_holds_exactly_its_two_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "minringFIR-mp") == set(MIN_RINGING)


@pytest.mark.parametrize("name", FIR_NAMES)
def test_an_fir_filter_carries_a_variant(api_client: TestClient, name: str) -> None:
    # Both variants of the family are real values, so no row of it falls back
    # to the family-only (null-variant) shape.
    assert _variant_of(_entries(api_client), name) is not None


# --- order inside the family --------------------------------------------------


def test_every_conventional_fir_row_serves_before_every_minimum_ringing_row(api_client: TestClient) -> None:
    # Both variants' rows are derived from the payload, so a row filed into
    # either variant out of place is caught, not just the five named ones.
    entries = _entries(api_client)
    order = _order(entries)
    assert max(order[n] for n in _variant_members(entries, "FIR")) < min(
        order[n] for n in _variant_members(entries, "minringFIR-mp")
    )


# --- the polynomial filters sit elsewhere, and later --------------------------


@pytest.mark.parametrize("name", POLYNOMIALS)
def test_a_polynomial_filter_is_filed_outside_the_fir_family(api_client: TestClient, name: str) -> None:
    # A null family would satisfy the inequality on its own, so the family it
    # does carry is pinned as real here rather than leaned on from elsewhere.
    entries = _entries(api_client)
    family = _family_of(entries, name)
    assert isinstance(family, str) and family.strip() != "" and family != _family_of(entries, "FIR")


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
    # Strictly increasing, not merely sorted: anchors that collapsed onto one
    # family would tie on first appearance and slip past a stable sort.
    served = [str(_family_of(entries, name)) for name in entries]
    first_seen = {family: served.index(family) for family in set(served)}
    positions = [first_seen[str(_family_of(entries, name))] for name in FAMILY_ANCHORS]
    assert positions == sorted(set(positions))
