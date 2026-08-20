"""Family and variant blurbs on the `/api/metadata` plain-names payload.

Each `plain_names` section now serves the three-key shape `{entries, families,
variants}`: `entries` is the per-name display dict previously served bare
(tests/api/test_metadata_plain_names.py pins its contents), while the filters
section additionally carries the owner-approved family and variant blurbs the
frontend shows as caption rows under the Simplified dropdown's headers. Variant
blurbs key by the composite `"<family>|<variant>"`, one per family+variant pair
present in the entries. The shaper sections keep the shape with empty blurb
maps. The same change retires the "Adaptive taps" wording from the filter
entries in favour of "Adaptive length".

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_genres.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

FAMILY_BLURBS = {
    "Polyphase sinc": "The most variety and flexibility",
    "Pure sinc": "Very long brute force filters",
    "Closed form": "Direct interpolation maintains original samples",
    "Misc": "Miscellaneous filters",
    "Analog-style": "Analog-like behavior; no pre-ringing, long post-ringing",
    "Classic oversampling": "The filter type found in most DACs",
    "Polynomial": "Almost no ringing, but weak suppression of ultrasonic content",
    "Minimum ringing": "Less ringing and better response/suppression than Polynomial",
}

_GAUSS = "Best balance of time and frequency accuracy, cleanest transients"
_EXT2 = "Sharper version of extended response, stronger suppression above the audio band"
_BASE = "The family's base form"

VARIANT_BLURBS = {
    "Polyphase sinc|Gaussian": _GAUSS,
    "Pure sinc|Gaussian": _GAUSS,
    "Polyphase sinc|Half-band": "Response reaches close to the cutoff; for clean, well-mastered sources",
    "Polyphase sinc|Gaussian half-band": "Gaussian character with a slightly leaky response reaching the cutoff",
    "Polyphase sinc|Extended frequency response": "Keeps response wide while fully cutting off at the limit",
    "Polyphase sinc|Extended frequency response 2": _EXT2,
    "Pure sinc|Extended frequency response 2": _EXT2,
    "Polyphase sinc|Extreme roll-off and attenuation": "Steepest cutoff and strongest suppression",
    "Pure sinc|Adaptive length": "Filter length adapts to the conversion for consistency",
    "Polyphase sinc|MQA and MP3": "Tailored for lossy sources",
    "Polyphase sinc|Base": _BASE,
    "Pure sinc|Base": _BASE,
}

ADAPTIVE_LENGTH_NAMES = ["sinc-Ls", "sinc-Lm", "sinc-Lh", "sinc-Ll", "sinc-L"]


def _section(client: TestClient, kind: str) -> dict[str, object]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, object]", payload["plain_names"][kind])


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    return cast("dict[str, dict[str, object]]", _section(client, "filters")["entries"])


def _filter_blurbs(client: TestClient, map_name: str) -> dict[str, str]:
    return cast("dict[str, str]", _section(client, "filters")[map_name])


# --- the three-key shape (every kind) ----------------------------------------


@pytest.mark.parametrize("kind", ["filters", "dithers", "modulators"])
def test_each_plain_names_section_serves_entries_families_and_variants(api_client: TestClient, kind: str) -> None:
    assert set(_section(api_client, kind)) == {"entries", "families", "variants"}


@pytest.mark.parametrize("kind", ["dithers", "modulators"])
@pytest.mark.parametrize("map_name", ["families", "variants"])
def test_the_shaper_sections_serve_empty_blurb_maps(api_client: TestClient, kind: str, map_name: str) -> None:
    assert _section(api_client, kind)[map_name] == {}


# --- the family blurbs -------------------------------------------------------


def test_the_filter_families_map_carries_exactly_the_eight_approved_keys(api_client: TestClient) -> None:
    assert set(_filter_blurbs(api_client, "families")) == set(FAMILY_BLURBS)


@pytest.mark.parametrize(("family", "wording"), sorted(FAMILY_BLURBS.items()))
def test_a_family_serves_its_exact_approved_blurb(api_client: TestClient, family: str, wording: str) -> None:
    assert _filter_blurbs(api_client, "families")[family] == wording


# --- the variant blurbs ------------------------------------------------------


def test_the_filter_variants_map_carries_exactly_the_twelve_approved_pairs(api_client: TestClient) -> None:
    assert set(_filter_blurbs(api_client, "variants")) == set(VARIANT_BLURBS)


def test_the_variant_blurbs_cover_every_family_variant_pair_in_the_entries(api_client: TestClient) -> None:
    pairs = {
        f"{entry['family']}|{entry['variant']}"
        for entry in _filter_entries(api_client).values()
        if entry.get("variant")
    }
    assert pairs == set(VARIANT_BLURBS)


@pytest.mark.parametrize(("pair", "wording"), sorted(VARIANT_BLURBS.items()))
def test_a_variant_pair_serves_its_exact_approved_blurb(api_client: TestClient, pair: str, wording: str) -> None:
    assert _filter_blurbs(api_client, "variants")[pair] == wording


# --- the Adaptive length rename ----------------------------------------------


def test_no_filter_wording_still_says_adaptive_taps(api_client: TestClient) -> None:
    offenders = [
        (name, field)
        for name, entry in _filter_entries(api_client).items()
        for field in ("variant", "leaf", "short")
        if "Adaptive taps" in str(entry.get(field) or "")
    ]
    assert offenders == []


@pytest.mark.parametrize("name", ADAPTIVE_LENGTH_NAMES)
def test_a_sinc_l_entry_carries_the_adaptive_length_variant(api_client: TestClient, name: str) -> None:
    assert _filter_entries(api_client)[name]["variant"] == "Adaptive length"


def test_sinc_l_serves_the_extra_long_leaf(api_client: TestClient) -> None:
    assert _filter_entries(api_client)["sinc-L"]["leaf"] == "Extra-long"


# sinc-L's closed-title tail abbreviates its "Extra-long" leaf to "X-long", per
# the data contract's short-wording scope; the other four compose verbatim.
@pytest.mark.parametrize(
    ("name", "tail"),
    [("sinc-Ls", None), ("sinc-Lm", None), ("sinc-Lh", None), ("sinc-Ll", None), ("sinc-L", "X-long")],
)
def test_a_sinc_l_short_reads_sinc_adaptive_length_then_its_leaf(
    api_client: TestClient, name: str, tail: str | None
) -> None:
    entry = _filter_entries(api_client)[name]
    assert entry["short"] == f"Sinc · Adaptive length · {tail or entry['leaf']}"


@pytest.mark.parametrize(
    ("field", "wording"),
    [("leaf", "Adaptive length"), ("short", "Sinc · Ext2 · Adaptive length")],
)
def test_sinc_s_reads_adaptive_length_as_its_leaf(api_client: TestClient, field: str, wording: str) -> None:
    assert _filter_entries(api_client)["sinc-S"][field] == wording
