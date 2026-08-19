"""The apodizing copy `/api/metadata` `plain_names.filters` serves.

The apodizing class moved off the display copy and onto the `apod` field (and
the frontend badge that renders it), so the three leaves that used to spell it
out serve their trimmed wording, the shorts keep their ", apod" tail, and no
`family`, `variant` or `leaf` value anywhere in the filters section says
"apodizing" any more — `short` values are exempt.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough — same as tests/api/test_metadata_plain_names.py.
"""

import pytest
from fastapi.testclient import TestClient


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    entries: dict[str, dict[str, object]] = payload["plain_names"]["filters"]["entries"]
    return entries


@pytest.mark.parametrize(
    ("name", "field", "wording"),
    [
        ("poly-sinc-ext2-xla", "leaf", "Extra-long linear phase"),
        ("poly-sinc-ext2-xla", "short", "Poly-sinc · Ext2 · X-long linear, apod"),
        ("poly-sinc-gauss-xla", "leaf", "Extra-long linear phase"),
        ("poly-sinc-gauss-xla", "short", "Poly-sinc · Gauss · X-long linear, apod"),
        ("sinc-MGa", "leaf", "Constant time"),
        ("sinc-MGa", "short", "Sinc · Gauss · Constant time, apod"),
    ],
)
def test_a_renamed_apodizing_filter_serves_its_exact_display_wording(
    api_client: TestClient, name: str, field: str, wording: str
) -> None:
    assert _filter_entries(api_client)[name][field] == wording


def test_no_filter_family_variant_or_leaf_still_says_apodizing(api_client: TestClient) -> None:
    # The word belongs to the badge now; `short` keeps its ", apod" tail and is
    # exempt, so only the three grouping/display fields are swept.
    offenders = [
        (name, field)
        for name, entry in _filter_entries(api_client).items()
        for field in ("family", "variant", "leaf")
        if "apodizing" in str(entry.get(field) or "").lower()
    ]
    assert offenders == []
