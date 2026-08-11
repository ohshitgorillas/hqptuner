"""Error contracts of the live-preset REST surface — the statuses and details the
LIVE card keys its messaging off.

Characterization of behaviour that already exists (docs/testing.md §8 exemption:
nothing here is new or changed). Every case is driven the way a caller reaches
it — a store file this HQPTuner cannot read, a name the store refuses, a preset
nobody saved, an engine whose loaded chain is unknowable, a daemon that drops the
connection mid-apply. No store method is stubbed and no manager internals are
touched: the fakes speak the wire, the store is a real file on disk.

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
from httpx import Response

#: A store stamped with a schema no build of this HQPTuner understands. Reading
#: it is refused outright rather than guessed at, on every route that touches it.
FUTURE_STORE: dict[str, Any] = {"schema": 99, "presets": {}}

#: A saved preset naming a filter enum the running engine no longer offers — the
#: live lane refuses the whole preset and says which field went stale.
STALE_STORE: dict[str, Any] = {
    "schema": 1,
    "presets": {"Stale": {"chain": "pcm", "fields": {"filter": "9999"}, "names": {}}},
}


#: Every distinct way a name breaks the live store's naming rule and reaches the
#: route to be refused. The rule is the ONLY condition under which saving raises
#: the store's plain error rather than the schema one: measured against the
#: store's public API, a save over a corrupt, unstamped, wrongly stamped or
#: structurally odd file succeeds, and a store stamped newer than this build
#: raises the schema error instead (409, above). Names carrying a real path
#: separator (``a/b``, ``/etc/passwd``, ``..`` unescaped, the empty name) never
#: reach the store at all — the router answers those itself.
REFUSED_NAMES = [
    pytest.param("a\\b", id="backslash"),
    pytest.param("..", id="parent-directory"),
    pytest.param("Studio..xml", id="embedded-double-dot"),
    pytest.param(".hidden", id="leading-dot"),
    pytest.param(" ", id="only-whitespace"),
    pytest.param(" Studio", id="leading-space"),
    pytest.param("Studio ", id="trailing-space"),
    pytest.param("a\x00b", id="nul"),
    pytest.param("a\x1fb", id="unit-separator"),
    pytest.param("a\x7fb", id="delete"),
    # 252 UTF-8 bytes: over the store's length limit even though it is well
    # under 255 characters, so a limit counting characters would accept it
    pytest.param("ä" * 126, id="over-255-bytes"),
]


def _path(name: str) -> str:
    """The route path for a preset name, every byte percent-encoded.

    Encoding the whole name is what lets a dot-shaped or control-character name
    reach the store's rule at all: left literal, the router resolves ``..`` and a
    bare ``.`` as path segments and answers before any handler runs."""
    encoded = "".join(f"%{byte:02X}" for byte in name.encode())
    return f"/api/livepresets/{encoded}"


def _seed(tmp_path: Path, store: dict[str, Any]) -> None:
    (tmp_path / "live-presets.json").write_text(json.dumps(store))


@pytest.fixture
def unreadable_api(live_api: TestClient, tmp_path: Path) -> Iterator[TestClient]:
    """The REST app over a live-preset store written by a newer HQPTuner."""
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


@pytest.fixture
def dropping_apply(chain_api: Callable[..., TestClient]) -> Response:
    """Applying a preset saved on the other chain against a daemon that drops the
    connection on the mode switch — what hqplayerd does while the switch takes the
    audio engine down, so the lane loses the socket mid-apply."""
    chain_api(mode="2").put("/api/livepresets/Dark")
    # Annotated rather than returned straight: TestClient's verbs are untyped
    # here, so a bare return is an Any return under strict mypy.
    dropped: Response = chain_api(mode="1", _close="SetMode").post("/api/livepresets/Dark/apply")
    return dropped


# --- GET /api/livepresets --------------------------------------------------------


def test_listing_presets_from_a_store_this_build_cannot_read_is_a_conflict(
    unreadable_api: TestClient,
) -> None:
    assert unreadable_api.get("/api/livepresets").status_code == 409


def test_listing_presets_from_an_unreadable_store_reports_the_schema_it_found(
    unreadable_api: TestClient,
) -> None:
    assert "schema 99" in unreadable_api.get("/api/livepresets").json()["detail"]


# --- PUT /api/livepresets/{name} -------------------------------------------------


def test_saving_with_the_engines_chain_unknown_is_a_conflict(chainless_api: TestClient) -> None:
    assert chainless_api.put("/api/livepresets/Warm").status_code == 409


def test_saving_with_the_engines_chain_unknown_says_so_against_the_chain(
    chainless_api: TestClient,
) -> None:
    # keyed by field, as the LIVE card marks the control it cannot fill
    assert "unknown" in chainless_api.put("/api/livepresets/Warm").json()["detail"]["chain"]


def test_saving_with_the_engines_chain_unknown_stores_nothing(chainless_api: TestClient) -> None:
    chainless_api.put("/api/livepresets/Warm")
    assert chainless_api.get("/api/livepresets").json()["presets"] == []


def test_saving_into_a_store_this_build_cannot_read_is_a_conflict(unreadable_api: TestClient) -> None:
    assert unreadable_api.put("/api/livepresets/Warm").status_code == 409


def test_saving_into_an_unreadable_store_reports_the_schema_it_found(unreadable_api: TestClient) -> None:
    assert "schema 99" in unreadable_api.put("/api/livepresets/Warm").json()["detail"]


@pytest.mark.parametrize("name", REFUSED_NAMES)
def test_saving_under_a_name_the_store_refuses_is_unprocessable(live_api: TestClient, name: str) -> None:
    assert live_api.put(_path(name)).status_code == 422


@pytest.mark.parametrize("name", REFUSED_NAMES)
def test_saving_under_a_name_the_store_refuses_quotes_the_name_it_was_given(live_api: TestClient, name: str) -> None:
    # the store's own complaint, verbatim: the rule that was broken and the name
    # that broke it, so the card can put the offending name back in front of the user
    assert live_api.put(_path(name)).json()["detail"] == f"invalid live preset name: {name!r}"


# --- POST /api/livepresets/{name}/apply ------------------------------------------


def test_applying_from_a_store_this_build_cannot_read_is_a_conflict(unreadable_api: TestClient) -> None:
    assert unreadable_api.post("/api/livepresets/Warm/apply").status_code == 409


def test_applying_from_an_unreadable_store_reports_the_schema_it_found(unreadable_api: TestClient) -> None:
    assert "schema 99" in unreadable_api.post("/api/livepresets/Warm/apply").json()["detail"]


def test_applying_a_preset_that_was_never_saved_is_not_found(live_api: TestClient) -> None:
    assert live_api.post("/api/livepresets/Nope/apply").status_code == 404


def test_applying_a_preset_that_was_never_saved_names_the_missing_preset(live_api: TestClient) -> None:
    assert "Nope" in live_api.post("/api/livepresets/Nope/apply").json()["detail"]


def test_applying_a_preset_the_engine_cannot_route_is_a_conflict(stale_api: TestClient) -> None:
    assert stale_api.post("/api/livepresets/Stale/apply").status_code == 409


def test_applying_a_preset_the_engine_cannot_route_details_the_refused_fields_alone(
    stale_api: TestClient,
) -> None:
    # the routing refusal's own reasons, unwrapped: one entry per field that could
    # not be routed and nothing else, so the card can mark exactly those controls
    assert set(stale_api.post("/api/livepresets/Stale/apply").json()["detail"]) == {"filter"}


def test_applying_a_preset_when_the_daemon_drops_the_connection_is_unavailable(
    dropping_apply: Response,
) -> None:
    assert dropping_apply.status_code == 503


def test_applying_a_preset_when_the_daemon_drops_the_connection_reports_the_lane_failure(
    dropping_apply: Response,
) -> None:
    assert "connection failed" in dropping_apply.json()["detail"]


# --- DELETE /api/livepresets/{name} ----------------------------------------------


def test_deleting_from_a_store_this_build_cannot_read_is_a_conflict(unreadable_api: TestClient) -> None:
    assert unreadable_api.delete("/api/livepresets/Warm").status_code == 409


def test_deleting_from_an_unreadable_store_reports_the_schema_it_found(unreadable_api: TestClient) -> None:
    assert "schema 99" in unreadable_api.delete("/api/livepresets/Warm").json()["detail"]


def test_deleting_a_preset_that_was_never_saved_is_not_found(live_api: TestClient) -> None:
    assert live_api.delete("/api/livepresets/Nope").status_code == 404


def test_deleting_a_preset_that_was_never_saved_names_the_missing_preset(live_api: TestClient) -> None:
    assert "Nope" in live_api.delete("/api/livepresets/Nope").json()["detail"]
