"""Error contracts of the live-snapshot REST surface — the statuses and details the
LIVE card keys its messaging off.

Characterization of behavior that already exists. Every case is driven the way a
caller reaches it — a store file this HQPTuner cannot read, a name the store
refuses, a preset nobody saved, an engine whose loaded chain is unknowable. No
store method is stubbed and no manager internals are touched: the fakes speak
the wire, the store is a real file on disk.

Detail assertions anchor on the substantive part of each message (the schema the
file is stamped with, the name that is missing, the field that went stale) rather
than the whole sentence — the schema complaint quotes HQPTuner's own version, so
a golden string would break at every release.
"""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

#: A store stamped with a schema no build of this HQPTuner understands. Reading
#: it is refused outright rather than guessed at, on every route that touches it.
FUTURE_STORE: dict[str, Any] = {"schema": 99, "presets": {}}

#: A saved preset naming a filter enum the running engine no longer offers — the
#: live lane refuses the whole preset and says which field went stale.
STALE_STORE: dict[str, Any] = {
    "schema": 1,
    "presets": {"Stale": {"chain": "pcm", "fields": {"filter": "9999"}, "names": {}}},
}


def _seed(tmp_path: Path, store: dict[str, Any]) -> None:
    (tmp_path / "live-presets.json").write_text(json.dumps(store))


@pytest.fixture
def unreadable_api(live_api: TestClient, tmp_path: Path) -> Iterator[TestClient]:
    """The REST app over a live-snapshot store written by a newer HQPTuner."""
    _seed(tmp_path, FUTURE_STORE)
    yield live_api


@pytest.fixture
def stale_api(live_api: TestClient, tmp_path: Path) -> Iterator[TestClient]:
    """The REST app over a store holding a preset the engine cannot route."""
    _seed(tmp_path, STALE_STORE)
    yield live_api


@pytest.fixture
def chainless_api(chain_api: Callable[..., TestClient]) -> TestClient:
    """An engine whose loaded chain cannot be determined: no mode configured, so
    it follows the source, and no source is playing to have loaded one."""
    return chain_api(mode="0", _active_mode="")


# --- GET /api/livepresets --------------------------------------------------------


def test_listing_presets_from_an_unreadable_store_reports_the_schema_it_found(
    unreadable_api: TestClient,
) -> None:
    assert "99" in unreadable_api.get("/api/livepresets").json()["detail"]


# --- PUT /api/livepresets/{name} -------------------------------------------------


def test_saving_with_the_engines_chain_unknown_details_the_chain_field_alone(
    chainless_api: TestClient,
) -> None:
    # keyed by field, as the LIVE card marks the control it cannot fill
    assert set(chainless_api.put("/api/livepresets/Warm").json()["detail"]) == {"chain"}


@pytest.mark.parametrize(
    ("app", "stored"),
    [pytest.param("chainless_api", [], id="chain-unknown"), pytest.param("live_api", ["Warm"], id="chain-known")],
)
def test_saving_stores_nothing_with_the_chain_unknown_but_the_preset_once_it_is_known(
    request: pytest.FixtureRequest, app: str, stored: list[str]
) -> None:
    client: TestClient = request.getfixturevalue(app)
    client.put("/api/livepresets/Warm")
    assert [p["name"] for p in client.get("/api/livepresets").json()["presets"]] == stored


def test_saving_into_an_unreadable_store_reports_the_schema_it_found(unreadable_api: TestClient) -> None:
    assert "99" in unreadable_api.put("/api/livepresets/Warm").json()["detail"]


# --- POST /api/livepresets/{name}/apply ------------------------------------------


def test_applying_from_an_unreadable_store_reports_the_schema_it_found(unreadable_api: TestClient) -> None:
    assert "99" in unreadable_api.post("/api/livepresets/Warm/apply").json()["detail"]


def test_applying_a_preset_that_was_never_saved_names_the_missing_preset(live_api: TestClient) -> None:
    assert "Nope" in live_api.post("/api/livepresets/Nope/apply").json()["detail"]


def test_applying_a_preset_the_engine_cannot_route_details_the_refused_fields_alone(
    stale_api: TestClient,
) -> None:
    # the routing refusal's own reasons, unwrapped: one entry per field that could
    # not be routed and nothing else, so the card can mark exactly those controls
    assert set(stale_api.post("/api/livepresets/Stale/apply").json()["detail"]) == {"filter"}


# --- DELETE /api/livepresets/{name} ----------------------------------------------


def test_deleting_a_preset_that_was_never_saved_names_the_missing_preset(live_api: TestClient) -> None:
    assert "Nope" in live_api.delete("/api/livepresets/Nope").json()["detail"]
