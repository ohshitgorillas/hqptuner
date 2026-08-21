"""Favorite filter NAMES, stored server-side (docs/testing.md).

Two surfaces, one behavior: `FavoriteStore` over a JSON file, and the
GET/PUT `/api/favorites` pair over that store. Neither touches hqplayerd —
favorites are HQPTuner's own state, keyed by filter name rather than by the
engine's enum ids (docs/architecture.md §2) — so every client here is built
with no credentials and a control lane pointed at a closed port, and every
store file lands under pytest's ``tmp_path``, never in the repo's state dir.

The on-disk stamp (`{"schema": N, "filters": [...]}`) is the layout contract a
DIFFERENT HQPTuner version reads. A test writes a stamped file by hand for the
same reason a wire test writes a frame by hand: the situation under test is one
another version created.
"""

import contextlib
import json
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.store.favorites import FavoriteError, FavoriteSchemaError, FavoriteStore

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = {"schema": 99, "filters": ["gauss-long"]}

#: Content that is not our record: not JSON at all, and JSON that is not an
#: object. Both are read as empty rather than raising — a corrupt file loses
#: stars, it does not brick the page.
UNREADABLE = ["not json at all {", "[]", '"gauss-long"', "17", "null"]

NAMES = ["poly-sinc-gauss-long", "sinc-M"]


def store_at(tmp_path: Path) -> FavoriteStore:
    return FavoriteStore(tmp_path / "favorites.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "favorites.json"
    path.write_text(content)
    return path


@pytest.fixture
def favorites_api(tmp_path: Path, closed_port: int) -> Iterator[Callable[[], TestClient]]:
    """The REST surface over a favorites file in ``tmp_path``, daemonless.

    `api_client` is the right shape but builds a bare `Config()`, whose
    `favorites_file` points into the repo's own state dir; a test writing there
    would outlive the run. A factory rather than a plain client so a case can
    hand-write a file another HQPTuner version stamped and then open the app
    over it.

    Every client is built with no credentials and a control lane pointed at
    `closed_port`, a port nothing listens on: nothing here can reach hqplayerd,
    so a route that answers at all answered without it."""
    clients: list[TestClient] = []

    def build() -> TestClient:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_username="",
            hqp_password="",
            favorites_file=tmp_path / "favorites.json",
        )
        client = TestClient(create_app(cfg))
        clients.append(client)
        client.__enter__()
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def fav_client(favorites_api: Callable[[], TestClient]) -> TestClient:
    return favorites_api()


# --- reading a store that was never written ---------------------------------


def test_reading_a_store_with_no_file_yields_no_favorites(tmp_path: Path) -> None:
    assert store_at(tmp_path).read() == []


def test_reading_a_store_with_no_file_creates_nothing(tmp_path: Path) -> None:
    store_at(tmp_path).read()
    assert list(tmp_path.iterdir()) == []


# --- the round trip ----------------------------------------------------------


def test_written_names_read_back(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAMES)
    assert sorted(store.read()) == sorted(NAMES)


def test_write_answers_with_the_names_deduplicated_and_sorted(tmp_path: Path) -> None:
    assert store_at(tmp_path).write(["zulu", "alpha", "zulu"]) == ["alpha", "zulu"]


# The file is hand-written rather than produced by `write`, so a store that
# normalizes only on the way out and hands back whatever the file holds fails
# here: the list on disk is one another version left behind.
def test_read_answers_with_the_names_deduplicated_and_sorted(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 1, "filters": ["zulu", "alpha", "zulu"]}))
    assert store_at(tmp_path).read() == ["alpha", "zulu"]


def test_a_write_replaces_the_whole_previous_set(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(["alpha", "bravo"])
    store.write(["alpha"])
    assert store.read() == ["alpha"]


def test_a_write_creates_the_file_and_its_parent_directory(tmp_path: Path) -> None:
    store = FavoriteStore(tmp_path / "never-created" / "favorites.json")
    store.write(["alpha"])
    assert (tmp_path / "never-created" / "favorites.json").is_file()


# --- the on-disk layout stamp ------------------------------------------------


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(FavoriteSchemaError, match="99"):
        store_at(tmp_path).read()


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_write(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(FavoriteSchemaError, match="99"):
        store_at(tmp_path).write(["alpha"])


def test_a_refused_write_leaves_the_newer_file_untouched(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the on-disk check (scripts/gates/check_test_assertions.py
    # counts a `pytest.raises` block as an assertion).
    path = seed(tmp_path, json.dumps(TOO_NEW))
    with contextlib.suppress(FavoriteError):
        store_at(tmp_path).write(["alpha"])
    assert json.loads(path.read_text()) == TOO_NEW


def test_the_schema_refusal_is_caught_by_a_caller_catching_the_general_error(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(FavoriteError):
        store_at(tmp_path).read()


def test_an_unstamped_file_is_read_rather_than_refused(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"filters": ["alpha"]}))
    assert store_at(tmp_path).read() == ["alpha"]


# Any stamp at all is not enough: the number a write puts on the file has to be
# one this version's `read` accepts, or the next start refuses its own file. The
# stamp is lifted off the written file and put on a second, hand-written one,
# which is then read: a missing stamp raises `KeyError` here, and a stamp this
# version refuses raises `FavoriteSchemaError`.
def test_an_unstamped_file_carries_a_stamp_after_the_next_write(tmp_path: Path) -> None:
    path = seed(tmp_path, json.dumps({"filters": ["alpha"]}))
    store_at(tmp_path).write(["bravo"])
    stamp = json.loads(path.read_text())["schema"]
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    seed(elsewhere, json.dumps({"schema": stamp, "filters": ["charlie"]}))
    assert store_at(elsewhere).read() == ["charlie"]


@pytest.mark.parametrize("content", UNREADABLE)
def test_a_file_that_is_not_our_record_reads_as_empty(tmp_path: Path, content: str) -> None:
    seed(tmp_path, content)
    assert store_at(tmp_path).read() == []


# --- what a name list may contain --------------------------------------------


@pytest.mark.parametrize(
    "names",
    [
        pytest.param(["alpha", 7], id="non-string"),
        pytest.param(["alpha", None], id="null"),
        pytest.param(["alpha", ""], id="empty-name"),
        pytest.param([f"name-{i}" for i in range(257)], id="257-names"),
        pytest.param(["x" * 65], id="65-char-name"),
    ],
)
def test_an_invalid_name_list_is_refused(tmp_path: Path, names: list[object]) -> None:
    with pytest.raises(FavoriteError):
        store_at(tmp_path).write(names)  # type: ignore[arg-type]


def test_exactly_256_names_are_accepted(tmp_path: Path) -> None:
    names = [f"name-{i}" for i in range(256)]
    assert len(store_at(tmp_path).write(names)) == 256


def test_a_name_of_exactly_64_characters_is_accepted(tmp_path: Path) -> None:
    assert store_at(tmp_path).write(["x" * 64]) == ["x" * 64]


# --- the REST pair -----------------------------------------------------------


def test_a_fresh_install_answers_get_with_no_favorites(fav_client: TestClient) -> None:
    assert fav_client.get("/api/favorites").json()["filters"] == []


def test_a_fresh_install_answers_get_with_200(fav_client: TestClient) -> None:
    assert fav_client.get("/api/favorites").status_code == 200


def test_put_then_get_answers_with_the_stored_names(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": NAMES})
    assert fav_client.get("/api/favorites").json()["filters"] == sorted(NAMES)


def test_putting_a_list_without_a_name_drops_it(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": ["alpha", "bravo"]})
    fav_client.put("/api/favorites", json={"filters": ["alpha"]})
    assert fav_client.get("/api/favorites").json()["filters"] == ["alpha"]


def test_putting_duplicates_stores_one_copy(fav_client: TestClient) -> None:
    fav_client.put("/api/favorites", json={"filters": ["alpha", "alpha"]})
    assert fav_client.get("/api/favorites").json()["filters"] == ["alpha"]


def test_put_answers_with_the_stored_list_so_no_follow_up_get_is_needed(fav_client: TestClient) -> None:
    answer = fav_client.put("/api/favorites", json={"filters": ["zulu", "alpha"]})
    assert answer.json()["filters"] == ["alpha", "zulu"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(["alpha"], id="bare-list"),
        pytest.param({}, id="no-filters-member"),
        pytest.param({"filters": "alpha"}, id="filters-not-a-list"),
        pytest.param({"filters": ["alpha", 7]}, id="non-string-name"),
        pytest.param({"filters": ["alpha", None]}, id="null-name"),
        pytest.param({"filters": [""]}, id="empty-name"),
        pytest.param({"filters": [f"name-{i}" for i in range(257)]}, id="257-names"),
        pytest.param({"filters": ["x" * 65]}, id="65-char-name"),
    ],
)
def test_a_put_the_store_would_refuse_answers_422(fav_client: TestClient, body: object) -> None:
    assert fav_client.put("/api/favorites", json=body).status_code == 422


def test_get_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, favorites_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert favorites_api().get("/api/favorites").status_code == 409


def test_put_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, favorites_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert favorites_api().put("/api/favorites", json={"filters": ["alpha"]}).status_code == 409


# Both directions of the pair, in one case, because the point being pinned is
# the pair itself: with hqplayerd unreachable (see `favorites_api`), reading and
# writing favorites both still answer. The other REST cases each pin one route's
# content; this one pins that neither route needs the daemon.
def test_favorites_are_served_in_both_directions_with_no_daemon_reachable(fav_client: TestClient) -> None:
    written = fav_client.put("/api/favorites", json={"filters": ["alpha"]})
    assert (written.status_code, fav_client.get("/api/favorites").status_code) == (200, 200)
