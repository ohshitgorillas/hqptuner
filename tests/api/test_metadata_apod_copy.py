"""Where the apodizing class shows up in `/api/metadata` `plain_names.filters`.

The class lives on the `apod` field (and the frontend badge that renders it), so
no `family`, `variant` or `leaf` value anywhere in the filters section says
"apodizing" any more. `short` is display copy and nothing here reads it.

The display wording itself is owner-owned data and no test asserts it
(docs/testing.md rule 9): only the field, and only the word's absence elsewhere.

Served by the static loader, so the guard-only `api_client` (no daemon behind
it) is enough, same as tests/api/test_metadata_plain_names.py.
"""

from fastapi.testclient import TestClient


def _filter_entries(client: TestClient) -> dict[str, dict[str, object]]:
    payload = client.get("/api/metadata").json()
    entries: dict[str, dict[str, object]] = payload["plain_names"]["filters"]["entries"]
    return entries


APOD_DOMAIN = {"full", "half", "none"}


def test_every_served_filter_carries_an_apod_value_from_the_known_set(api_client: TestClient) -> None:
    offenders = [name for name, entry in _filter_entries(api_client).items() if entry.get("apod") not in APOD_DOMAIN]
    assert offenders == []


def test_no_filter_family_variant_or_leaf_still_says_apodizing(api_client: TestClient) -> None:
    # The word belongs to the badge now. `short` is display copy and is not
    # swept, so only the three grouping/display fields are.
    offenders = [
        (name, field)
        for name, entry in _filter_entries(api_client).items()
        for field in ("family", "variant", "leaf")
        if "apodizing" in str(entry.get(field) or "").lower()
    ]
    assert offenders == []
