"""Family and variant blurbs on the `/api/metadata` plain-names payload.

Each `plain_names` section now serves the three-key shape `{entries, families,
variants}`: `entries` is the per-name display dict previously served bare
(tests/api/test_metadata_plain_names.py pins its contents), while the filters
and modulators sections additionally carry the owner-approved family and
variant blurbs the frontend shows as caption rows under the Simplified
dropdown's headers. Variant blurbs key by the composite `"<family>|<variant>"`,
one per family+variant pair present in that section's entries. The dithers
section now carries family blurbs too, so no section serves entirely empty
blurb maps; its `variants` map alone stays empty, because every dither entry
has a null variant. The same change retires the "Adaptive taps" wording from
the filter entries in favour of "Adaptive length".

Static loader data, so the guard-only `api_client` (no daemon behind it) is
enough — same as tests/api/test_metadata_genres.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

FILTER_FAMILY_BLURBS = {
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

FILTER_VARIANT_BLURBS = {
    "Polyphase sinc|Gaussian": _GAUSS,
    "Pure sinc|Gaussian": _GAUSS,
    "Polyphase sinc|Half-band": "Response reaches the cutoff; for clean, well-mastered sources",
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

MODULATOR_FAMILY_BLURBS = {
    "Fixed": "Same behavior regardless of source",
    "Adaptive": "Adapts to the source",
    "Pseudo multi-bit": "Special pseudo multi-bit modulators for DSD512+",
    "Hybrid": "Multi-level and multi-bit designs",
}

_FIFTH = "Suits DACs with simple analog reconstruction filters; recommended for ESS Sabre DACs"
_SEVENTH = "Better technical performance, more demands on the DAC's analog filter; optimal for most DACs"

MODULATOR_VARIANT_BLURBS = {
    "Fixed|Fifth order": _FIFTH,
    "Fixed|Seventh order": _SEVENTH,
    "Adaptive|Fifth order": _FIFTH,
    "Adaptive|Seventh order": _SEVENTH,
    "Pseudo multi-bit|Seventh order": _SEVENTH,
    "Hybrid|Fifth order": _FIFTH,
    "Hybrid|Seventh order": _SEVENTH,
}

DITHER_FAMILY_BLURBS = {
    "Noise shaping": "Pushes noise above the hearing range via error feedback loop; optimal for R-2R DACs",
    "Additive": "Evens out low-level distortions by adding random noise",
    "None": "No noise treatment; provided as a reference, not for critical listening",
}

ADAPTIVE_LENGTH_NAMES = ["sinc-Ls", "sinc-Lm", "sinc-Lh", "sinc-Ll", "sinc-L"]


def _section(client: TestClient, kind: str) -> dict[str, object]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, object]", payload["plain_names"][kind])


def _entries(client: TestClient, kind: str) -> dict[str, dict[str, object]]:
    return cast("dict[str, dict[str, object]]", _section(client, kind)["entries"])


def _blurbs(client: TestClient, kind: str, map_name: str) -> dict[str, str]:
    return cast("dict[str, str]", _section(client, kind)[map_name])


def _pairs_in_entries(client: TestClient, kind: str) -> set[str]:
    return {
        f"{entry['family']}|{entry['variant']}" for entry in _entries(client, kind).values() if entry.get("variant")
    }


def _families_in_entries(client: TestClient, kind: str) -> set[str]:
    return {str(entry["family"]) for entry in _entries(client, kind).values()}


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    return _entries(client, "filters")


# --- the three-key shape (every kind) ----------------------------------------


@pytest.mark.parametrize("kind", ["filters", "dithers", "modulators"])
def test_each_plain_names_section_serves_entries_families_and_variants(api_client: TestClient, kind: str) -> None:
    assert set(_section(api_client, kind)) == {"entries", "families", "variants"}


def test_the_dithers_section_serves_an_empty_variant_blurb_map(api_client: TestClient) -> None:
    assert _section(api_client, "dithers")["variants"] == {}


def test_no_dither_entry_carries_a_variant(api_client: TestClient) -> None:
    assert _pairs_in_entries(api_client, "dithers") == set()


# --- the dither family blurbs ------------------------------------------------


def test_the_dither_families_map_carries_exactly_the_three_approved_keys(api_client: TestClient) -> None:
    assert set(_blurbs(api_client, "dithers", "families")) == set(DITHER_FAMILY_BLURBS)


def test_the_dither_family_blurbs_cover_every_family_in_the_entries(api_client: TestClient) -> None:
    assert _families_in_entries(api_client, "dithers") == set(DITHER_FAMILY_BLURBS)


@pytest.mark.parametrize(("family", "wording"), sorted(DITHER_FAMILY_BLURBS.items()))
def test_a_dither_family_serves_its_exact_approved_blurb(api_client: TestClient, family: str, wording: str) -> None:
    assert _blurbs(api_client, "dithers", "families")[family] == wording


# --- the filter family blurbs ------------------------------------------------


def test_the_filter_families_map_carries_exactly_the_eight_approved_keys(api_client: TestClient) -> None:
    assert set(_blurbs(api_client, "filters", "families")) == set(FILTER_FAMILY_BLURBS)


@pytest.mark.parametrize(("family", "wording"), sorted(FILTER_FAMILY_BLURBS.items()))
def test_a_filter_family_serves_its_exact_approved_blurb(api_client: TestClient, family: str, wording: str) -> None:
    assert _blurbs(api_client, "filters", "families")[family] == wording


# --- the filter variant blurbs -----------------------------------------------


def test_the_filter_variants_map_carries_exactly_the_twelve_approved_pairs(api_client: TestClient) -> None:
    assert set(_blurbs(api_client, "filters", "variants")) == set(FILTER_VARIANT_BLURBS)


def test_the_filter_variant_blurbs_cover_every_family_variant_pair_in_the_entries(api_client: TestClient) -> None:
    assert _pairs_in_entries(api_client, "filters") == set(FILTER_VARIANT_BLURBS)


@pytest.mark.parametrize(("pair", "wording"), sorted(FILTER_VARIANT_BLURBS.items()))
def test_a_filter_variant_pair_serves_its_exact_approved_blurb(api_client: TestClient, pair: str, wording: str) -> None:
    assert _blurbs(api_client, "filters", "variants")[pair] == wording


# --- the modulator family blurbs ---------------------------------------------


def test_the_modulator_families_map_carries_exactly_the_four_approved_keys(api_client: TestClient) -> None:
    assert set(_blurbs(api_client, "modulators", "families")) == set(MODULATOR_FAMILY_BLURBS)


@pytest.mark.parametrize(("family", "wording"), sorted(MODULATOR_FAMILY_BLURBS.items()))
def test_a_modulator_family_serves_its_exact_approved_blurb(api_client: TestClient, family: str, wording: str) -> None:
    assert _blurbs(api_client, "modulators", "families")[family] == wording


# --- the modulator variant blurbs --------------------------------------------


def test_the_modulator_variants_map_carries_exactly_the_seven_approved_pairs(api_client: TestClient) -> None:
    assert set(_blurbs(api_client, "modulators", "variants")) == set(MODULATOR_VARIANT_BLURBS)


def test_the_modulator_variant_blurbs_cover_every_family_variant_pair_in_the_entries(api_client: TestClient) -> None:
    assert _pairs_in_entries(api_client, "modulators") == set(MODULATOR_VARIANT_BLURBS)


@pytest.mark.parametrize(("pair", "wording"), sorted(MODULATOR_VARIANT_BLURBS.items()))
def test_a_modulator_variant_pair_serves_its_exact_approved_blurb(
    api_client: TestClient, pair: str, wording: str
) -> None:
    assert _blurbs(api_client, "modulators", "variants")[pair] == wording


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
