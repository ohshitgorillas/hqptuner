"""The one FIR family the filters overlay splits into three variants.

Six engine filter names — `FIR`, `asymFIR`, `minphaseFIR`, `minringFIR-lp`,
`minringFIR-mp` and `FFT` — are filed under a single family, split into exactly
three variants: the first three share one, the next two share another, and
`FFT` is the sole member of the third. No other entry in the section carries
any of them. Inside the family the three-filter variant serves ahead of the
two-filter variant; where the `FFT` variant falls among them is not pinned
here, the spec does not fix it. `polynomial-1` and `polynomial-2` are filed
elsewhere and serve after all six: they share a family with the four
`closed-form*` names, and that merged family's membership and its two variants
are pinned at the foot of this file. The section's family order runs `IIR`,
this family, `poly-sinc-mp`, the closed-form family, `sinc-L`, `none` — one
anchor per family, six distinct families. The entries dict's key order IS the
dropdown display order, so ordering is read off that.

Family and variant memberships are derived from the payload rather than from
the six names above, so a seventh row filed into the family, or into any
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
FFT_ONLY = ["FFT"]
FIR_NAMES = CONVENTIONAL + MIN_RINGING + FFT_ONLY

CLOSED_FORM = ["closed-form", "closed-form-fast", "closed-form-M", "closed-form-16M"]
POLYNOMIALS = ["polynomial-1", "polynomial-2"]
CLOSED_FORM_FAMILY = CLOSED_FORM + POLYNOMIALS

# One raw name per family, in the order the overlay serves those families.
FAMILY_ANCHORS = ["IIR", "FIR", "poly-sinc-mp", "closed-form", "sinc-L", "none"]


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


# --- one family, three variants -----------------------------------------------


def test_the_six_fir_filters_share_one_family(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert len({str(_family_of(entries, name)) for name in FIR_NAMES}) == 1


def test_the_fir_family_carries_exactly_three_variants(api_client: TestClient) -> None:
    # The family's membership is read off the payload, not assumed from the
    # six names below: a seventh row filed into it under a fourth variant is a
    # violation this test has to see.
    entries = _entries(api_client)
    assert len({str(_variant_of(entries, name)) for name in _family_members(entries, "FIR")}) == 3


def test_the_fir_family_holds_exactly_its_six_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _family_members(entries, "FIR") == set(FIR_NAMES)


def test_the_conventional_fir_variant_holds_exactly_its_three_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "FIR") == set(CONVENTIONAL)


def test_the_minimum_ringing_fir_variant_holds_exactly_its_two_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "minringFIR-mp") == set(MIN_RINGING)


def test_the_fft_variant_holds_exactly_that_one_filter(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "FFT") == set(FFT_ONLY)


@pytest.mark.parametrize("name", FIR_NAMES)
def test_an_fir_filter_carries_a_variant(api_client: TestClient, name: str) -> None:
    # All three variants of the family are real values, so no row of it falls
    # back to the family-only (null-variant) shape.
    assert _variant_of(_entries(api_client), name) is not None


# --- order inside the family --------------------------------------------------


def test_every_conventional_fir_row_serves_before_every_minimum_ringing_row(api_client: TestClient) -> None:
    # Both variants' rows are derived from the payload, so a row filed into
    # either variant out of place is caught, not just the six named ones.
    entries = _entries(api_client)
    order = _order(entries)
    assert max(order[n] for n in _variant_members(entries, "FIR")) < min(
        order[n] for n in _variant_members(entries, "minringFIR-mp")
    )


# --- the closed-form family, polynomials included -----------------------------


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


def test_the_closed_form_family_holds_exactly_its_six_filters(api_client: TestClient) -> None:
    # Membership is read off the payload, so a seventh row filed in alongside
    # the four closed-form names and the two polynomials is caught here.
    entries = _entries(api_client)
    assert _family_members(entries, "closed-form") == set(CLOSED_FORM_FAMILY)


def test_the_closed_form_family_carries_exactly_two_variants(api_client: TestClient) -> None:
    entries = _entries(api_client)
    members = _family_members(entries, "closed-form")
    assert len({str(_variant_of(entries, name)) for name in members}) == 2


def test_the_closed_form_variant_holds_exactly_its_four_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "closed-form") == set(CLOSED_FORM)


def test_the_polynomial_variant_holds_exactly_its_two_filters(api_client: TestClient) -> None:
    entries = _entries(api_client)
    assert _variant_members(entries, "polynomial-1") == set(POLYNOMIALS)


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
