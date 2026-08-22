"""Where the apodizing class shows up in `/api/metadata` `plain_names.filters`.

The class lives on the `apod` field (and the frontend badge that renders it), so
no `family`, `variant` or `leaf` value anywhere in the filters section says
"apodizing" any more. `short` is the exception: it carries the class as a ",
apod" tail, which is a structural fact about that field rather than a sentence.

The display wording itself is owner-owned data and no test asserts it
(docs/testing.md rule 9) — only the tail, and only its absence elsewhere.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough — same as tests/api/test_metadata_plain_names.py.
"""

import pytest
from fastapi.testclient import TestClient


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    entries: dict[str, dict[str, object]] = payload["plain_names"]["filters"]["entries"]
    return entries


@pytest.mark.parametrize("name", ["poly-sinc-ext2-xla", "poly-sinc-gauss-xla", "sinc-MGa"])
def test_an_apodizing_filters_short_name_keeps_its_apod_tail(api_client: TestClient, name: str) -> None:
    assert str(_filter_entries(api_client)[name]["short"]).endswith(", apod")


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
