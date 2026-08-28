"""Favorite MODULATOR names, the second set the favorites store keeps.

The store already held one set of starred filter names in one JSON file beside
the live presets; this suite pins the second set living in the same file, read
and written through `read_modulators`/`write_modulators`, and served by the same
GET/PUT `/api/favorites` pair under a `modulators` member. Neither surface
touches hqplayerd — a favorite is HQPTuner's own record, keyed by the engine's
NAME rather than by an enum id (docs/architecture.md §2).

Everything here reuses `tests/presets/test_favorites.py`: its `favorites_api`
factory (a daemonless `TestClient` over a store file under `tmp_path`), its
`fav_client` shorthand, its `seed`/`store_at` helpers, and its `TOO_NEW` stamp —
the situation a 409 tests is one another HQPTuner version created, so that file
stays hand-written rather than produced by this version's `write`.

The one thing this suite never does is hand-write a stamp NUMBER of its own: a
seeded file is left unstamped, which the store adopts, so no case here has to
guess which schema this version claims.
"""

import contextlib
import json
from collections.abc import Callable
from pathlib import Path

import pytest
import test_favorites
from fastapi.testclient import TestClient
from test_favorites import TOO_NEW, UNSTORABLE, seed, store_at

from hqptuner.presets.store.favorites import FavoriteError, FavoriteSchemaError

# The two fixtures this suite shares with `test_favorites.py`, bound here so
# pytest finds them in this module's namespace. Bound by assignment rather than
# imported by name because a fixture imported by name and then taken as a test
# parameter reads as a redefinition (ruff F811), and re-exporting them from a
# `tests/presets/conftest.py` is not available either: several suites in this
# directory do `from conftest import ...` expecting the ROOT conftest, which a
# package-level one would shadow.
favorites_api = test_favorites.favorites_api
fav_client = test_favorites.fav_client

#: The layout number on the favorites file, unchanged by this feature and
#: therefore the number an older HQPTuner expects to find there.
SCHEMA = 1

MODULATORS = ["ASDM7EC", "DSD7 256+fs"]

FILTERS = ["poly-sinc-gauss-long", "sinc-M"]


# --- the modulator set on its own --------------------------------------------


def test_a_fresh_store_reads_no_modulator_favorites(tmp_path: Path) -> None:
    assert store_at(tmp_path).read_modulators() == []


def test_written_modulator_names_read_back(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write_modulators(MODULATORS)
    assert sorted(store.read_modulators()) == sorted(MODULATORS)


def test_write_modulators_answers_with_the_names_deduplicated_and_sorted(tmp_path: Path) -> None:
    assert store_at(tmp_path).write_modulators(["zulu", "alpha", "zulu"]) == ["alpha", "zulu"]


# Hand-written rather than produced by `write_modulators`, so a store that
# normalizes only on the way out fails here: the list on disk is one another
# version left behind.
def test_read_modulators_answers_with_the_names_deduplicated_and_sorted(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"modulators": ["zulu", "alpha", "zulu"]}))
    assert store_at(tmp_path).read_modulators() == ["alpha", "zulu"]


def test_a_modulator_write_replaces_the_whole_previous_set(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write_modulators(["alpha", "bravo"])
    store.write_modulators(["alpha"])
    assert store.read_modulators() == ["alpha"]


# --- the two sets do not touch each other -------------------------------------


def test_writing_modulators_leaves_the_stored_filters_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(FILTERS)
    store.write_modulators(MODULATORS)
    assert store.read() == sorted(FILTERS)


def test_writing_filters_leaves_the_stored_modulators_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write_modulators(MODULATORS)
    store.write(FILTERS)
    assert store.read_modulators() == sorted(MODULATORS)


# The layout every HQPTuner before this one wrote: filters and nothing else.
# An absent member is an empty set, never a malformed file.
def test_a_file_holding_only_filters_reads_no_modulator_favorites(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"filters": ["alpha"]}))
    assert store_at(tmp_path).read_modulators() == []


def test_a_file_holding_only_filters_still_reads_its_filters(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"filters": ["alpha"]}))
    assert store_at(tmp_path).read() == ["alpha"]


# --- what a modulator name list may contain -----------------------------------


# The same sweep the filter side runs, against the same store rules: a list
# `write` refuses is one `write_modulators` refuses.
@pytest.mark.parametrize("names", UNSTORABLE)
def test_an_invalid_modulator_name_list_is_refused(tmp_path: Path, names: list[object]) -> None:
    with pytest.raises(FavoriteError):
        store_at(tmp_path).write_modulators(names)  # type: ignore[arg-type]


def test_exactly_256_modulator_names_are_accepted(tmp_path: Path) -> None:
    names = [f"name-{i}" for i in range(256)]
    assert len(store_at(tmp_path).write_modulators(names)) == 256


def test_a_modulator_name_of_exactly_64_characters_is_accepted(tmp_path: Path) -> None:
    assert store_at(tmp_path).write_modulators(["x" * 64]) == ["x" * 64]


# --- the on-disk layout stamp -------------------------------------------------


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_reading_modulators(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(FavoriteSchemaError, match="99"):
        store_at(tmp_path).read_modulators()


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_writing_modulators(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(FavoriteSchemaError, match="99"):
        store_at(tmp_path).write_modulators(["alpha"])


def test_a_refused_modulator_write_leaves_the_newer_file_untouched(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the on-disk check.
    path = seed(tmp_path, json.dumps(TOO_NEW))
    with contextlib.suppress(FavoriteError):
        store_at(tmp_path).write_modulators(["alpha"])
    assert json.loads(path.read_text()) == TOO_NEW


def test_an_unstamped_file_has_its_modulators_read_rather_than_refused(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"modulators": ["alpha"]}))
    assert store_at(tmp_path).read_modulators() == ["alpha"]


# The stamp this feature must not move. Adding a second member to the file was
# deliberately NOT a layout change: an HQPTuner built before this feature still
# reads a file this one wrote, because the number on it is the one it has always
# been. Pinned as a LITERAL, because a stamp lifted off a file this same build
# wrote is this build agreeing with itself — a feature that bumped the number
# for every write at once would keep such a test green while every older build
# started refusing the file.
def test_a_modulator_write_leaves_the_layout_stamp_where_older_builds_read_it(tmp_path: Path) -> None:
    store_at(tmp_path).write_modulators(["alpha"])
    assert json.loads((tmp_path / "favorites.json").read_text())["schema"] == SCHEMA


# --- the REST pair ------------------------------------------------------------


def test_put_then_get_answers_with_the_stored_modulator_names(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"modulators": MODULATORS})
    assert fav_client.get("/api/favorites").json()["modulators"] == sorted(MODULATORS)


def test_a_modulator_put_answers_with_the_stored_list_so_no_follow_up_get_is_needed(
    fav_client: TestClient,
) -> None:
    answer = fav_client.put("/api/favorites", json={"modulators": ["zulu", "alpha"]})
    assert answer.json()["modulators"] == ["alpha", "zulu"]


def test_a_modulator_put_answers_with_the_filter_list_too(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": ["alpha"]})
    answer = fav_client.put("/api/favorites", json={"modulators": ["ASDM7EC"]})
    assert answer.json()["filters"] == ["alpha"]


def test_putting_a_modulator_list_without_a_name_drops_it(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"modulators": ["alpha", "bravo"]})
    fav_client.put("/api/favorites", json={"modulators": ["alpha"]})
    assert fav_client.get("/api/favorites").json()["modulators"] == ["alpha"]


def test_putting_duplicate_modulator_names_stores_one_copy(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"modulators": ["alpha", "alpha"]})
    assert fav_client.get("/api/favorites").json()["modulators"] == ["alpha"]


# An absent member means "leave that set alone", never "empty it": a client that
# stars a filter must not silently drop every starred modulator, and the other
# way round.
def test_a_put_carrying_only_filters_leaves_the_stored_modulators_alone(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"modulators": MODULATORS})
    fav_client.put("/api/favorites", json={"filters": FILTERS})
    assert fav_client.get("/api/favorites").json()["modulators"] == sorted(MODULATORS)


def test_a_put_carrying_only_modulators_leaves_the_stored_filters_alone(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": FILTERS})
    fav_client.put("/api/favorites", json={"modulators": MODULATORS})
    assert fav_client.get("/api/favorites").json()["filters"] == sorted(FILTERS)


# Read back through a fresh GET rather than off the PUT's own answer: a route
# that normalizes the body, echoes it and stores nothing satisfies its own
# response, and "stores" is the word these two cases are making good on.
def test_a_put_carrying_both_lists_stores_the_modulator_one(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": FILTERS, "modulators": MODULATORS})
    assert fav_client.get("/api/favorites").json()["modulators"] == sorted(MODULATORS)


def test_a_put_carrying_both_lists_stores_the_filter_one(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": FILTERS, "modulators": MODULATORS})
    assert fav_client.get("/api/favorites").json()["filters"] == sorted(FILTERS)


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"modulators": "alpha"}, id="modulators-not-a-list"),
        pytest.param({"modulators": ["alpha", 7]}, id="non-string-name"),
        pytest.param({"modulators": ["alpha", None]}, id="null-name"),
        pytest.param({"modulators": [""]}, id="empty-name"),
        pytest.param({"modulators": [f"name-{i}" for i in range(257)]}, id="257-names"),
        pytest.param({"modulators": ["x" * 65]}, id="65-char-name"),
    ],
)
def test_a_modulator_put_the_store_would_refuse_answers_422(fav_client: TestClient, body: object) -> None:
    assert fav_client.put("/api/favorites", json=body).status_code == 422


def test_get_against_a_store_stamped_by_a_newer_hqptuner_answers_409_for_modulators(
    tmp_path: Path, favorites_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert favorites_api().get("/api/favorites").status_code == 409


def test_a_modulator_put_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, favorites_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert favorites_api().put("/api/favorites", json={"modulators": ["alpha"]}).status_code == 409


# A body naming NEITHER set is not a write at all. The two members are optional
# individually — an absent one leaves that set alone — but a PUT has to name at
# least one of them to be a PUT, so an empty object is refused rather than
# answered as a no-op. (The `no-filters-member` case in test_favorites.py is the
# same rule from the filter side.)
def test_a_put_naming_neither_set_answers_422(fav_client: TestClient) -> None:
    assert fav_client.put("/api/favorites", json={}).status_code == 422
