"""The plain-names overlay `/api/metadata` serves for the six chain dropdowns.

The running engine stays the sole authority for enumeration names, IDs and
ordering (docs/architecture.md §2); this payload only ANNOTATES, joined by raw
engine name. Each of the three sections — filters, dithers, modulators — maps a
raw name to the display record the frontend regroups the dropdown by: `family`,
`variant` (nullable), `leaf` and `short`, with filters additionally classified
`apod`. The filter data spans both chains' enumerations, PCM and SDM, 84 unique
names including every `-2s` entry.

A section's key order is its dropdown display order, so the ordering tests
below pin that order rather than any wording: phase groups run minimum,
intermediate, linear; a two-stage row follows its single-stage peer; a group's
bare row precedes its lengths, ascending; and an apodizing row follows its
non-apodizing peer. Display wording is owner-owned data and no test asserts it
— `short` is pinned as non-empty and unique per section, and a filter's
family+variant+leaf+apod identity as unique across the section.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough — same as tests/api/test_metadata_genres.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

DISPLAY_FIELDS = {"family", "variant", "leaf", "short"}
SECTIONS = ["filters", "dithers", "modulators"]


def _plain_names(client: TestClient) -> dict[str, dict[str, dict[str, dict[str, object]]]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, dict[str, dict[str, object]]]]", payload["plain_names"])


def _entries(client: TestClient, section: str) -> dict[str, dict[str, object]]:
    return _plain_names(client)[section]["entries"]


def test_metadata_serves_a_plain_names_section_per_dropdown_kind(api_client: TestClient) -> None:
    assert {"filters", "dithers", "modulators"} <= set(_plain_names(api_client))


def test_plain_names_covers_the_84_filter_names_of_both_chains(api_client: TestClient) -> None:
    assert len(_entries(api_client, "filters")) == 84


def test_a_known_engine_filter_name_is_annotated(api_client: TestClient) -> None:
    assert "poly-sinc-gauss-long" in _entries(api_client, "filters")


def test_all_sixteen_two_stage_filter_names_are_annotated(api_client: TestClient) -> None:
    assert len([name for name in _entries(api_client, "filters") if name.endswith("-2s")]) == 16


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_carries_the_display_fields(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    assert [name for name, entry in entries.items() if not set(entry) >= DISPLAY_FIELDS] == []


@pytest.mark.parametrize("section", SECTIONS)
def test_a_sections_entries_are_not_empty(api_client: TestClient, section: str) -> None:
    assert _entries(api_client, section) != {}


@pytest.mark.parametrize("section", SECTIONS)
def test_every_entry_serves_a_non_empty_short_label(api_client: TestClient, section: str) -> None:
    entries = _entries(api_client, section)
    offenders = [
        name
        for name, entry in entries.items()
        if not isinstance(entry["short"], str) or not str(entry["short"]).strip()
    ]
    assert offenders == []


@pytest.mark.parametrize("section", SECTIONS)
def test_no_two_entries_of_a_section_share_a_short_label(api_client: TestClient, section: str) -> None:
    shorts = [str(entry["short"]) for entry in _entries(api_client, section).values()]
    assert sorted(s for s in set(shorts) if shorts.count(s) > 1) == []


def test_every_filter_entry_classifies_apodizing(api_client: TestClient) -> None:
    entries = _entries(api_client, "filters")
    assert [name for name, entry in entries.items() if "apod" not in entry] == []


def test_no_two_filter_entries_share_a_family_variant_leaf_and_apodizing_identity(api_client: TestClient) -> None:
    # The composed identity is what the regrouped dropdown shows for a row, so
    # two rows sharing one would be indistinguishable to the reader.
    identities = [
        (entry["family"], entry["variant"], entry["leaf"], entry["apod"])
        for entry in _entries(api_client, "filters").values()
    ]
    assert sorted(str(i) for i in set(identities) if identities.count(i) > 1) == []


def test_every_phase_variant_group_serves_minimum_intermediate_linear_order(
    api_client: TestClient,
) -> None:
    # Within one family+variant group the overlay's own entry order is the
    # display order, and phase variants order minimum, intermediate, linear.
    # The groups are derived from the served keys themselves: every base name
    # serving all three of -mp/-ip/-lp is a trio (mp before ip before lp), and
    # every base serving only -mp/-lp is a pair (mp before lp). The derivation
    # must find at least one trio — the overlay ships phase families — so an
    # empty sweep is itself a violation rather than a vacuous pass.
    order = {name: i for i, name in enumerate(_entries(api_client, "filters"))}
    trios = [b for b in (n[:-3] for n in order if n.endswith("-mp")) if f"{b}-ip" in order]
    pairs = [b for b in (n[:-3] for n in order if n.endswith("-mp")) if f"{b}-ip" not in order and f"{b}-lp" in order]
    violations = [b for b in trios if not order[f"{b}-mp"] < order[f"{b}-ip"] < order[f"{b}-lp"]]
    violations += [b for b in pairs if not order[f"{b}-mp"] < order[f"{b}-lp"]]
    violations += [] if trios else ["no -mp/-ip/-lp trio derived from the served keys"]
    assert violations == []


def test_every_two_stage_filter_serves_after_its_single_stage_peer(api_client: TestClient) -> None:
    # Two-stage rows follow their non-two-stage peer: wherever both the "-2s"
    # key and the key with "-2s" removed are served, the "-2s" key iterates
    # later.
    order = {name: i for i, name in enumerate(_entries(api_client, "filters"))}
    violations = [
        name
        for name in order
        if "-2s" in name and name.replace("-2s", "") in order and order[name] < order[name.replace("-2s", "")]
    ]
    assert violations == []


def test_half_band_serves_bare_row_first_then_lengths_ascending(api_client: TestClient) -> None:
    # Within a family/variant group the bare/default row comes first and the
    # length variants ascend — pinned on the Half-band group.
    wanted = ["poly-sinc-hb", "poly-sinc-hb-xs", "poly-sinc-hb-s", "poly-sinc-hb-m", "poly-sinc-hb-l"]
    served = [name for name in _entries(api_client, "filters") if name in wanted]
    assert served == wanted


def test_an_apodizing_row_serves_after_its_non_apodizing_peer(api_client: TestClient) -> None:
    wanted = ["poly-sinc-gauss-xl", "poly-sinc-gauss-xla"]
    served = [name for name in _entries(api_client, "filters") if name in wanted]
    assert served == wanted
