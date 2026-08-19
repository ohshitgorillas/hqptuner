"""The plain-names overlay `/api/metadata` serves for the six chain dropdowns.

The running engine stays the sole authority for enumeration names, IDs and
ordering (docs/architecture.md §2); this payload only ANNOTATES, joined by raw
engine name. Each of the three sections — filters, dithers, modulators — maps a
raw name to the display record the frontend regroups the dropdown by: `family`,
`variant` (nullable), `leaf` and `short`, with filters additionally classified
`apod`. The filter data spans both chains' enumerations, PCM and SDM, 84 unique
names including every `-2s` entry.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough — same as tests/api/test_metadata_genres.py.
"""

from typing import cast

import pytest
from fastapi.testclient import TestClient

DISPLAY_FIELDS = {"family", "variant", "leaf", "short"}


def _plain_names(client: TestClient) -> dict[str, dict[str, dict[str, dict[str, object]]]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, dict[str, dict[str, object]]]]", payload["plain_names"])


def test_metadata_serves_a_plain_names_section_per_dropdown_kind(api_client: TestClient) -> None:
    assert {"filters", "dithers", "modulators"} <= set(_plain_names(api_client))


def test_plain_names_covers_the_84_filter_names_of_both_chains(api_client: TestClient) -> None:
    assert len(_plain_names(api_client)["filters"]["entries"]) == 84


def test_a_known_engine_filter_name_is_annotated(api_client: TestClient) -> None:
    assert "poly-sinc-gauss-long" in _plain_names(api_client)["filters"]["entries"]


def test_all_sixteen_two_stage_filter_names_are_annotated(api_client: TestClient) -> None:
    assert len([name for name in _plain_names(api_client)["filters"]["entries"] if name.endswith("-2s")]) == 16


@pytest.mark.parametrize(
    ("section", "name", "field", "wording"),
    [
        ("filters", "poly-sinc-gauss-long", "family", "Polyphase sinc"),
        ("filters", "poly-sinc-gauss-long", "variant", "Gaussian"),
        ("filters", "poly-sinc-gauss-long", "leaf", "Long linear phase"),
        ("filters", "poly-sinc-gauss-long", "short", "Poly-sinc · Gauss · Long linear"),
        ("filters", "poly-sinc-hb-m", "leaf", "Medium linear phase"),
        ("filters", "poly-sinc-hb-m", "short", "Poly-sinc · Half-band · Medium linear"),
        ("filters", "poly-sinc-ext2-short", "leaf", "Short linear phase"),
        ("filters", "poly-sinc-ext2-short", "short", "Poly-sinc · Ext2 · Short linear"),
        ("filters", "poly-sinc-gauss-halfband", "leaf", "Linear phase"),
        ("filters", "poly-sinc-gauss-halfband", "short", "Poly-sinc · Gauss half-band · Linear"),
        ("filters", "poly-sinc-hb-s-2s", "leaf", "Short linear phase, two-stage"),
        ("filters", "poly-sinc-hb-s-2s", "short", "Poly-sinc · Half-band · Short linear, 2-stage"),
        ("dithers", "TPDF", "leaf", "Triangular, any rate"),
        ("dithers", "TPDF", "short", "Additive · Triangular, any rate"),
        ("modulators", "ASDM5", "leaf", "Base"),
        ("modulators", "ASDM5", "short", "Adaptive · 5th order · Base"),
    ],
)
def test_a_known_entry_serves_its_exact_display_wording(
    api_client: TestClient, section: str, name: str, field: str, wording: str
) -> None:
    assert _plain_names(api_client)[section]["entries"][name][field] == wording


@pytest.mark.parametrize("section", ["filters", "dithers", "modulators"])
def test_every_entry_carries_the_display_fields(api_client: TestClient, section: str) -> None:
    entries = _plain_names(api_client)[section]["entries"]
    assert [name for name, entry in entries.items() if not set(entry) >= DISPLAY_FIELDS] == []


@pytest.mark.parametrize("section", ["dithers", "modulators"])
def test_the_shaper_sections_are_not_empty(api_client: TestClient, section: str) -> None:
    assert _plain_names(api_client)[section]["entries"] != {}


def test_every_filter_entry_classifies_apodizing(api_client: TestClient) -> None:
    entries = _plain_names(api_client)["filters"]["entries"]
    assert [name for name, entry in entries.items() if "apod" not in entry] == []


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
    order = {name: i for i, name in enumerate(_plain_names(api_client)["filters"]["entries"])}
    trios = [b for b in (n[:-3] for n in order if n.endswith("-mp")) if f"{b}-ip" in order]
    pairs = [b for b in (n[:-3] for n in order if n.endswith("-mp")) if f"{b}-ip" not in order and f"{b}-lp" in order]
    violations = [b for b in trios if not order[f"{b}-mp"] < order[f"{b}-ip"] < order[f"{b}-lp"]]
    violations += [b for b in pairs if not order[f"{b}-mp"] < order[f"{b}-lp"]]
    violations += [] if trios else ["no -mp/-ip/-lp trio derived from the served keys"]
    assert violations == []


def test_no_filter_or_modulator_wording_still_says_standard(api_client: TestClient) -> None:
    # The "Standard" leaf/variant/short wording was renamed "Base" throughout
    # the filters and modulators overlays; no served display string may still
    # carry the old word.
    sections = _plain_names(api_client)
    offenders = [
        (section, name, field)
        for section in ("filters", "modulators")
        for name, entry in sections[section]["entries"].items()
        for field in ("leaf", "variant", "short")
        if "Standard" in str(entry.get(field) or "")
    ]
    assert offenders == []


def test_every_two_stage_filter_serves_after_its_single_stage_peer(api_client: TestClient) -> None:
    # Two-stage rows follow their non-two-stage peer: wherever both the "-2s"
    # key and the key with "-2s" removed are served, the "-2s" key iterates
    # later.
    order = {name: i for i, name in enumerate(_plain_names(api_client)["filters"]["entries"])}
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
    served = [name for name in _plain_names(api_client)["filters"]["entries"] if name in wanted]
    assert served == wanted


def test_an_apodizing_row_serves_after_its_non_apodizing_peer(api_client: TestClient) -> None:
    wanted = ["poly-sinc-gauss-xl", "poly-sinc-gauss-xla"]
    served = [name for name in _plain_names(api_client)["filters"]["entries"] if name in wanted]
    assert served == wanted


def test_the_misc_family_serves_after_every_other_family(api_client: TestClient) -> None:
    # Misc is the catch-all and iterates last: no "Misc" entry may precede any
    # entry of another family.
    entries = _plain_names(api_client)["filters"]["entries"]
    names = list(entries)
    last_other = max(i for i, name in enumerate(names) if entries[name]["family"] != "Misc")
    violations = [name for i, name in enumerate(names) if entries[name]["family"] == "Misc" and i < last_other]
    assert violations == []
