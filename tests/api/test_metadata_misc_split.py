"""The split of the filters overlay's catch-all `Misc` family into named families.

Nine filters previously filed under `Misc` with a null variant are promoted into
four new families — `Analog-style`, `Classic oversampling`, `Polynomial` and
`Minimum ringing` — leaving three genuinely unrelated names (`none`, `FFT`,
`ASRC`) behind in `Misc`. The promotion is display wording only: the running
engine stays the sole authority for the enumeration itself (docs/architecture.md
§2) and the overlay joins to it by raw name, so nothing here needs a daemon.
Family blurbs for the new families are pinned in tests/api/test_metadata_blurbs.py.

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_plain_names.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

MISC_NAMES = ["none", "FFT", "ASRC"]

NEW_FAMILIES = ["Analog-style", "Classic oversampling", "Polynomial", "Minimum ringing"]

# name -> (family, leaf, short) for every name leaving Misc.
PROMOTED = {
    "IIR": ("Analog-style", "Very steep", "Analog-style · Very steep"),
    "IIR2": ("Analog-style", "Steep", "Analog-style · Steep"),
    "FIR": ("Classic oversampling", "Base", "Classic FIR · Base"),
    "asymFIR": ("Classic oversampling", "Asymmetric", "Classic FIR · Asymmetric"),
    "minphaseFIR": ("Classic oversampling", "Minimum phase", "Classic FIR · Minimum"),
    "polynomial-1": ("Polynomial", "No ringing", "Polynomial · No ringing"),
    "polynomial-2": ("Polynomial", "One ringing cycle", "Polynomial · One cycle"),
    "minringFIR-mp": ("Minimum ringing", "Minimum phase", "Minimum ringing · Minimum"),
    "minringFIR-lp": ("Minimum ringing", "Linear phase", "Minimum ringing · Linear"),
}

# name -> (leaf, short) for the three names that stay behind.
MISC_WORDING = {
    "none": ("No resampling", "No resampling"),
    "FFT": ("Frequency-domain brickwall", "Frequency-domain brickwall"),
    "ASRC": ("Asynchronous, any rate", "Asynchronous, any rate"),
}

FAMILY_ORDER = [
    "Polyphase sinc",
    "Pure sinc",
    "Closed form",
    "Analog-style",
    "Classic oversampling",
    "Polynomial",
    "Minimum ringing",
    "Misc",
]

_PROMOTED_FIELDS = [
    (name, field, wording)
    for name, row in PROMOTED.items()
    for field, wording in zip(("family", "leaf", "short"), row, strict=True)
]

_MISC_FIELDS = [
    (name, field, wording)
    for name, row in MISC_WORDING.items()
    for field, wording in zip(("leaf", "short"), row, strict=True)
]


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, object]]", payload["plain_names"]["filters"]["entries"])


def _filter_variant_blurbs(client: TestClient) -> dict[str, str]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, str]", payload["plain_names"]["filters"]["variants"])


# --- what stays in Misc ------------------------------------------------------


def test_only_none_fft_and_asrc_are_still_filed_under_misc(api_client: TestClient) -> None:
    entries = _filter_entries(api_client)
    assert sorted(name for name, entry in entries.items() if entry["family"] == "Misc") == sorted(MISC_NAMES)


@pytest.mark.parametrize(("name", "field", "wording"), _MISC_FIELDS)
def test_a_surviving_misc_entry_keeps_its_exact_wording(
    api_client: TestClient, name: str, field: str, wording: str
) -> None:
    assert _filter_entries(api_client)[name][field] == wording


# --- what the promoted names now serve ---------------------------------------


@pytest.mark.parametrize(("name", "field", "wording"), _PROMOTED_FIELDS)
def test_a_promoted_filter_serves_its_new_family_leaf_and_short(
    api_client: TestClient, name: str, field: str, wording: str
) -> None:
    assert _filter_entries(api_client)[name][field] == wording


@pytest.mark.parametrize("family", [*NEW_FAMILIES, "Misc"])
def test_no_entry_of_an_unvarianted_family_carries_a_variant(api_client: TestClient, family: str) -> None:
    # A family serving no entries at all would pass this vacuously, so the
    # absence of the family is itself a violation.
    entries = _filter_entries(api_client)
    members = {name: entry for name, entry in entries.items() if entry["family"] == family}
    violations = [name for name, entry in members.items() if entry["variant"] is not None]
    violations += [] if members else [f"{family} serves no entries"]
    assert violations == []


@pytest.mark.parametrize("family", NEW_FAMILIES)
def test_a_new_family_contributes_no_variant_blurb(api_client: TestClient, family: str) -> None:
    # A family serving no entries at all would pass this vacuously — the blurb
    # is absent because the family is — so its absence is itself a violation.
    served = [entry for entry in _filter_entries(api_client).values() if entry["family"] == family]
    violations = [pair for pair in _filter_variant_blurbs(api_client) if pair.split("|")[0] == family]
    violations += [] if served else [f"{family} serves no entries"]
    assert violations == []


# --- ordering and uniqueness -------------------------------------------------


def test_the_filter_families_first_appear_in_the_approved_order(api_client: TestClient) -> None:
    seen: list[str] = []
    for entry in _filter_entries(api_client).values():
        family = cast("str", entry["family"])
        if family not in seen:
            seen.append(family)
    assert seen == FAMILY_ORDER


def test_every_filter_short_title_is_unique(api_client: TestClient) -> None:
    shorts = [entry["short"] for entry in _filter_entries(api_client).values()]
    assert sorted(set(cast("list[str]", shorts))) == sorted(cast("list[str]", shorts))


def test_the_analog_style_family_serves_steep_before_very_steep(api_client: TestClient) -> None:
    # Within a family the gentler row comes first, the same shape the length
    # groups ascend in: IIR2 reads "Steep", IIR reads "Very steep".
    wanted = ["IIR2", "IIR"]
    served = [name for name in _filter_entries(api_client) if name in wanted]
    assert served == wanted
