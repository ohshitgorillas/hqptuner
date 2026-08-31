"""The plain-names overlay for the two DSD-source PCM dropdowns.

`/api/metadata` `plain_names` grows two GROUPED sections, `noise_filter` and
`pcm_conversion`, annotating the daemon's `/config` form enumerations of the
same names (hqplayerd-readme.txt pdm_filter / pdm_conversion; the raw names
below are the wire identifiers the 6.0.4 form fixture serves). Each entry maps
a raw engine name to `family` (non-empty), `variant` (null throughout — these
enumerations carry no variant axis), `leaf` and `short`; every family an entry
names carries a blurb in its section's `families` map, and no blurb is an
orphan.

The recommendation flag: a `rec` key, where present, is the boolean `True`
and nothing else, and no entry of any other plain-names section carries one.
Which entries are recommended, and whether a section recommends any at all,
is owner data and no test names them (docs/testing.md rule 9). That is why
the `rec` sweep carries no non-empty guard: a key's value is contract (the
flag is `True` or absent), while whether any entry is recommended is owner
data, so the sweep pins validity and nothing pins presence.

Section key order is display order, so family runs are pinned contiguous:
once a family's run ends, no later entry names it again. The order of entries
within a run is curation and not asserted. Display wording is owner-owned
data and no test asserts a label, family name or blurb string; `short` is
pinned non-empty and unique per section.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough — same as tests/api/test_metadata_plain_names.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

GROUPED_FIELDS = {"family", "variant", "leaf", "short"}
SECTIONS = ["noise_filter", "pcm_conversion"]

# The engine's own enumerations, as the daemon's config form serves them
# (tests/support/fixtures/config-form-6.0.4.html).
ENGINE_NAMES = {
    "noise_filter": {
        "standard",
        "low",
        "high-order",
        "sac",
        "wec",
        "wec2",
        "slow-lp",
        "slow-mp",
        "medium",
        "medium-high",
        "fast-lp",
        "fast-mp",
        "brickwall",
    },
    "pcm_conversion": {
        "traditional",
        "single-steep",
        "single-short",
        "sinc-S",
        "sinc-M",
        "poly-lp",
        "poly-mp",
        "poly-short-lp",
        "poly-short-mp",
        "poly-xtr",
        "poly-xtr-short",
        "poly-ext2",
        "poly-gauss-long",
        "none",
    },
}


def _plain_names(client: TestClient) -> dict[str, dict[str, dict[str, dict[str, object]]]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, dict[str, dict[str, object]]]]", payload["plain_names"])


def _entries(client: TestClient, section: str) -> dict[str, dict[str, object]]:
    return _plain_names(client)[section]["entries"]


def _families(client: TestClient, section: str) -> dict[str, object]:
    return cast("dict[str, object]", _plain_names(client)[section]["families"])


def test_metadata_serves_a_plain_names_section_for_the_pcm_source_dropdowns(api_client: TestClient) -> None:
    assert {"noise_filter", "pcm_conversion"} <= set(_plain_names(api_client))


@pytest.mark.parametrize("section", SECTIONS)
def test_every_engine_name_is_annotated(api_client: TestClient, section: str) -> None:
    assert set(_entries(api_client, section)) >= ENGINE_NAMES[section]


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_carries_the_grouped_display_fields(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    assert [name for name, entry in entries.items() if not set(entry) >= GROUPED_FIELDS] == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_serves_a_non_empty_family(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    offenders = [
        name
        for name, entry in entries.items()
        if not isinstance(entry.get("family"), str) or not str(entry["family"]).strip()
    ]
    assert offenders == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entrys_variant_is_null(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    assert [name for name, entry in entries.items() if entry.get("variant") is not None] == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_serves_a_non_empty_leaf(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    offenders = [
        name
        for name, entry in entries.items()
        if not isinstance(entry.get("leaf"), str) or not str(entry["leaf"]).strip()
    ]
    assert offenders == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_serves_a_non_empty_short_label(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    offenders = [
        name
        for name, entry in entries.items()
        if not isinstance(entry.get("short"), str) or not str(entry["short"]).strip()
    ]
    assert offenders == []


@pytest.mark.parametrize("section", SECTIONS)
def test_no_two_entries_of_a_section_share_a_short_label(api_client: TestClient, section: str) -> None:
    shorts = [str(entry["short"]) for entry in _entries(api_client, section).values()]
    assert sorted(s for s in set(shorts) if shorts.count(s) > 1) == []


@pytest.mark.parametrize("section", SECTIONS)
def test_family_runs_are_contiguous_in_entry_order(api_client: TestClient, section: str) -> None:
    # Section key order is display order: once a family's run of entries ends,
    # no later entry names that family again.
    families = [str(entry["family"]) for entry in _entries(api_client, section).values()]
    violations = [f for i, f in enumerate(families) if f in families[:i] and families[i - 1] != f]
    assert violations == []


# --- the family blurbs --------------------------------------------------------


@pytest.mark.parametrize("section", SECTIONS)
def test_every_family_blurb_is_a_non_empty_string(api_client: TestClient, section: str) -> None:
    blurbs = _families(api_client, section)
    offenders = [family for family, blurb in blurbs.items() if not isinstance(blurb, str) or not blurb.strip()]
    assert offenders == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_family_blurb_key_is_a_family_some_entry_names(api_client: TestClient, section: str) -> None:
    # No orphan blurb: a families key nothing names would caption a header
    # that never renders.
    named = {str(entry["family"]) for entry in _entries(api_client, section).values()}
    assert sorted(family for family in _families(api_client, section) if family not in named) == []


@pytest.mark.parametrize("section", SECTIONS)
def test_every_family_an_entry_names_has_a_blurb(api_client: TestClient, section: str) -> None:
    # No blurbless family: every family header a section renders is captioned.
    blurbs = _families(api_client, section)
    named = {str(entry["family"]) for entry in _entries(api_client, section).values()}
    assert sorted(family for family in named if family not in blurbs) == []


# --- the recommendation flag --------------------------------------------------


@pytest.mark.parametrize("section", SECTIONS)
def test_every_rec_key_present_carries_the_boolean_true(api_client: TestClient, section: str) -> None:
    # The key is a flag: present means True, and no other value is served under it.
    entries = _entries(api_client, section)
    assert [name for name, entry in entries.items() if "rec" in entry and entry["rec"] is not True] == []


def test_no_entry_of_any_other_plain_names_section_carries_a_rec_key(api_client: TestClient) -> None:
    sections = _plain_names(api_client)
    offenders = [
        f"{section}:{name}"
        for section, body in sections.items()
        if section not in SECTIONS
        for name, entry in body["entries"].items()
        if "rec" in entry
    ]
    assert offenders == []
