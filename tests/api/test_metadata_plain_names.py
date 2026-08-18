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


def _plain_names(client: TestClient) -> dict[str, dict[str, dict[str, object]]]:
    payload = client.get("/api/metadata").json()
    return cast("dict[str, dict[str, dict[str, object]]]", payload["plain_names"])


def test_metadata_serves_a_plain_names_section_per_dropdown_kind(api_client: TestClient) -> None:
    assert {"filters", "dithers", "modulators"} <= set(_plain_names(api_client))


def test_plain_names_covers_the_84_filter_names_of_both_chains(api_client: TestClient) -> None:
    assert len(_plain_names(api_client)["filters"]) == 84


def test_a_known_engine_filter_name_is_annotated(api_client: TestClient) -> None:
    assert "poly-sinc-gauss-long" in _plain_names(api_client)["filters"]


def test_all_sixteen_two_stage_filter_names_are_annotated(api_client: TestClient) -> None:
    assert len([name for name in _plain_names(api_client)["filters"] if name.endswith("-2s")]) == 16


@pytest.mark.parametrize(
    ("section", "name", "field", "wording"),
    [
        ("filters", "poly-sinc-gauss-long", "family", "Polyphase sinc"),
        ("filters", "poly-sinc-gauss-long", "variant", "Gaussian"),
        ("filters", "poly-sinc-gauss-long", "leaf", "Long length"),
        ("filters", "poly-sinc-gauss-long", "short", "Poly-sinc · Gauss · Long length"),
        ("dithers", "TPDF", "leaf", "Triangular, any rate"),
        ("dithers", "TPDF", "short", "Additive · Triangular, any rate"),
        ("modulators", "ASDM5", "leaf", "Standard"),
        ("modulators", "ASDM5", "short", "Adaptive · 5th order · Standard"),
    ],
)
def test_a_known_entry_serves_its_exact_display_wording(
    api_client: TestClient, section: str, name: str, field: str, wording: str
) -> None:
    assert _plain_names(api_client)[section][name][field] == wording


@pytest.mark.parametrize("section", ["filters", "dithers", "modulators"])
def test_every_entry_carries_the_display_fields(api_client: TestClient, section: str) -> None:
    entries = _plain_names(api_client)[section]
    assert [name for name, entry in entries.items() if not set(entry) >= DISPLAY_FIELDS] == []


@pytest.mark.parametrize("section", ["dithers", "modulators"])
def test_the_shaper_sections_are_not_empty(api_client: TestClient, section: str) -> None:
    assert _plain_names(api_client)[section] != {}


def test_every_filter_entry_classifies_apodizing(api_client: TestClient) -> None:
    entries = _plain_names(api_client)["filters"]
    assert [name for name, entry in entries.items() if "apod" not in entry] == []
