"""The narrow bar's facets, stored server-side (docs/testing.md).

Two surfaces, one behaviour: `NarrowingStore` over a JSON file, and the GET/PUT
`/api/narrowing` pair over that store. Narrowing is purely presentational —
it picks which filters a dropdown offers and never stages a value or reaches
hqplayerd (docs/architecture.md, "Filter narrowing") — so every client here is
built with no credentials and a control lane pointed at a closed port, and every
store file lands under pytest's ``tmp_path``, never in the repo's state dir.

The facets and their defaults are the contract this file is written against;
`DEFAULTS` below is that table, not a snapshot of anything. The rate half is
the tri-state ``hide_limited`` (``auto``/``on``/``off``, default ``auto``) and
the two real booleans ``odd_rate_only`` and ``downsafe_only`` (default False,
truthy strings refused); the retired ``hide_2x``, ``hide_int``, ``ratio`` and
``upsample_only`` keys are refused on write and never surfaced on read.

On-disk layout: the file carries a schema stamp under ``schema``, the way
`favoritestore` stamps its own file. Where the facets themselves sit inside that
file the spec does not say, so every case that has to reach into a stored file
goes through `edit_facets`, which accepts either a nested ``facets`` member or
the facets at the top level beside the stamp. A hand-written file is used only
where the situation under test is one another version — or a broken write — left
behind.
"""

import contextlib
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.narrowingstore import NarrowingError, NarrowingSchemaError, NarrowingStore

#: Every facet at its default — the table the feature is specified by.
DEFAULTS: dict[str, object] = {
    "genre": [],
    "genre_mode": "and",
    "quality": 3,
    "focus": [],
    "focus_mode": "or",
    "phase": "",
    "length": "",
    "hide_limited": "auto",
    "odd_rate_only": False,
    "downsafe_only": False,
    "apod_1x": "only",
    "apod_nx": "all",
    "hires_1x": "hide",
    "hires_nx": "all",
}

#: One in-domain value per facet, each different from that facet's default.
SET: dict[str, object] = {
    "genre": ["rock"],
    "genre_mode": "or",
    "quality": 4,
    "focus": ["timbre"],
    "focus_mode": "and",
    "phase": "linear",
    "length": "long",
    "hide_limited": "on",
    "odd_rate_only": True,
    "downsafe_only": True,
    "apod_1x": "all",
    "apod_nx": "only",
    "hires_1x": "show",
    "hires_nx": "only",
}

#: Well-typed tokens outside each facet's domain.
OUT_OF_DOMAIN: dict[str, object] = {
    "genre": ["banana"],
    "quality": 7,
    "focus": ["loudness"],
    "phase": "banana",
    "length": "enormous",
    "hide_limited": "yes",
    "apod_1x": "some",
    "apod_nx": "some",
    "hires_1x": "maybe",
    "hires_nx": "hide",
}

#: A value of the wrong type for each facet.
WRONG_TYPE: dict[str, object] = {
    "genre": 3,
    "quality": "4",
    "focus": "timbre",
    "phase": 1,
    "length": ["long"],
    "hide_limited": True,
    # The two switches are real booleans: a truthy string is refused, never
    # coerced.
    "odd_rate_only": "on",
    "downsafe_only": "true",
    "apod_1x": 0,
    "apod_nx": None,
    "hires_1x": ["show"],
    "hires_nx": 2,
}

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = 99

#: Content that is not our record: not JSON at all, and JSON that is not an
#: object. Both read as every facet at its default — a corrupt file loses the
#: narrowing, it does not brick the narrow bar.
UNREADABLE = ["not json at all {", "[]", '"linear"', "17", "null"]


def store_at(tmp_path: Path) -> NarrowingStore:
    return NarrowingStore(tmp_path / "narrowing.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "narrowing.json"
    path.write_text(content)
    return path


def stored(tmp_path: Path, facets: dict[str, object]) -> Path:
    """A file the store itself wrote, so its layout is the store's own."""
    store_at(tmp_path).write(facets)
    return tmp_path / "narrowing.json"


def edit_facets(path: Path, mutate: Callable[[dict[str, Any]], None]) -> None:
    """Reach into the facet map of a file the store wrote and change it.

    Either layout is accepted — the facets nested under ``facets``, or the
    facets beside the stamp at the top level — so these cases pin what a stored
    entry means rather than where it sits.
    """
    doc = json.loads(path.read_text())
    inner = doc.get("facets")
    mutate(inner if isinstance(inner, dict) else doc)
    path.write_text(json.dumps(doc))


def keep_only(names: set[str]) -> Callable[[dict[str, Any]], None]:
    """A `edit_facets` mutation that drops every facet outside ``names``.

    The schema stamp is never dropped: under a flat layout it sits in the same
    dict as the facets, and a case about a file holding only some facets must
    not quietly become a case about a file carrying no stamp.
    """

    def mutate(facets: dict[str, Any]) -> None:
        for key in [k for k in facets if k not in names and k != "schema"]:
            del facets[key]

    return mutate


def set_to(facet: str, value: object) -> Callable[[dict[str, Any]], None]:
    """A `edit_facets` mutation that stores ``value`` under ``facet``."""

    def mutate(facets: dict[str, Any]) -> None:
        facets[facet] = value

    return mutate


def restamp(path: Path, schema: int) -> None:
    doc = json.loads(path.read_text())
    doc["schema"] = schema
    path.write_text(json.dumps(doc))


def unstamp(path: Path) -> None:
    doc = json.loads(path.read_text())
    doc.pop("schema", None)
    path.write_text(json.dumps(doc))


@pytest.fixture
def narrowing_api(tmp_path: Path, closed_port: int) -> Iterator[Callable[[], TestClient]]:
    """The REST surface over a narrowing file in ``tmp_path``, daemonless.

    A factory rather than a plain client so a case can hand a file another
    HQPTuner version stamped to a freshly opened app. Every client is built with
    no credentials and a control lane pointed at `closed_port`, a port nothing
    listens on: nothing here can reach hqplayerd, so a route that answers at all
    answered without it."""
    clients: list[TestClient] = []

    def build() -> TestClient:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_username="",
            hqp_password="",
            narrowing_file=tmp_path / "narrowing.json",
        )
        client = TestClient(create_app(cfg))
        clients.append(client)
        client.__enter__()
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def nar_client(narrowing_api: Callable[[], TestClient]) -> TestClient:
    return narrowing_api()


# --- reading a store that was never written ---------------------------------


def test_reading_a_store_with_no_file_yields_every_facet_at_its_default(tmp_path: Path) -> None:
    assert store_at(tmp_path).read() == DEFAULTS


def test_reading_a_store_with_no_file_creates_nothing(tmp_path: Path) -> None:
    store_at(tmp_path).read()
    assert list(tmp_path.iterdir()) == []


# --- the round trip ----------------------------------------------------------


@pytest.mark.parametrize("facet", sorted(SET))
def test_a_written_facet_reads_back_as_written(tmp_path: Path, facet: str) -> None:
    store = store_at(tmp_path)
    store.write(SET)
    assert store.read()[facet] == SET[facet]


# Order within a genre list is not specified, so both orderings pass: what is
# pinned is that neither entry is dropped.
def test_both_entries_of_a_two_genre_write_read_back(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write({"genre": ["rock", "jazz"]})
    assert store.read()["genre"] in (["rock", "jazz"], ["jazz", "rock"])


def test_write_answers_with_what_a_following_read_answers(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    assert store.write(SET) == store.read()


def test_a_write_creates_the_file_and_its_parent_directory(tmp_path: Path) -> None:
    store = NarrowingStore(tmp_path / "never-created" / "narrowing.json")
    store.write(SET)
    assert (tmp_path / "never-created" / "narrowing.json").is_file()


# --- a partial write ---------------------------------------------------------


def test_a_partial_write_stores_the_facet_it_names(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write({"quality": 4})
    assert store.read()["quality"] == 4


def test_a_partial_write_stores_the_facets_it_omits_at_their_defaults(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(SET)
    store.write({"quality": 4})
    assert store.read() == {**DEFAULTS, "quality": 4}


# --- what a stored file may hold ---------------------------------------------


def test_a_file_holding_only_some_facets_reads_those_facets_as_stored(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, keep_only({"phase", "quality"}))
    assert store_at(tmp_path).read()["phase"] == "linear"


def test_a_file_holding_only_some_facets_reads_the_rest_at_their_defaults(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, keep_only({"phase", "quality"}))
    assert store_at(tmp_path).read()["length"] == ""


def test_a_key_that_is_not_a_facet_is_ignored_on_read(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to("wombat", "yes"))
    assert "wombat" not in store_at(tmp_path).read()


@pytest.mark.parametrize("facet", sorted(WRONG_TYPE))
def test_a_wrong_typed_stored_facet_reads_as_its_default(tmp_path: Path, facet: str) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to(facet, WRONG_TYPE[facet]))
    assert store_at(tmp_path).read()[facet] == DEFAULTS[facet]


def test_a_wrong_typed_stored_facet_leaves_the_other_facets_alone(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to("quality", "4"))
    assert store_at(tmp_path).read()["phase"] == "linear"


@pytest.mark.parametrize("facet", sorted(OUT_OF_DOMAIN))
def test_an_out_of_domain_stored_facet_reads_as_its_default(tmp_path: Path, facet: str) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to(facet, OUT_OF_DOMAIN[facet]))
    assert store_at(tmp_path).read()[facet] == DEFAULTS[facet]


def test_an_out_of_domain_stored_facet_leaves_the_other_facets_alone(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to("phase", "banana"))
    assert store_at(tmp_path).read()["length"] == "long"


@pytest.mark.parametrize("content", UNREADABLE)
def test_a_file_that_is_not_our_record_reads_as_every_facet_at_its_default(tmp_path: Path, content: str) -> None:
    seed(tmp_path, content)
    assert store_at(tmp_path).read() == DEFAULTS


# --- what a write may carry ---------------------------------------------------


@pytest.mark.parametrize("facet", sorted(OUT_OF_DOMAIN))
def test_an_out_of_domain_write_is_refused_naming_the_facet(tmp_path: Path, facet: str) -> None:
    with pytest.raises(NarrowingError, match=facet):
        store_at(tmp_path).write({facet: OUT_OF_DOMAIN[facet]})


@pytest.mark.parametrize("facet", sorted(WRONG_TYPE))
def test_a_wrong_typed_write_is_refused(tmp_path: Path, facet: str) -> None:
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({facet: WRONG_TYPE[facet]})


def test_a_write_carrying_a_key_that_is_not_a_facet_is_refused_naming_that_key(tmp_path: Path) -> None:
    with pytest.raises(NarrowingError, match="wombat"):
        store_at(tmp_path).write({"wombat": "yes"})


# --- the retired rate facets --------------------------------------------------
# The single-select ratio, the upsample-only flag and the per-class hide pair
# are no longer facets at all: a client still writing them is refused the way
# any unknown key is, and a file an older HQPTuner left carrying them reads as
# if they were never there.

RETIRED: dict[str, object] = {
    "ratio": "2x",
    "upsample_only": True,
    "hide_2x": "on",
    "hide_int": "off",
}


@pytest.mark.parametrize("legacy", sorted(RETIRED))
def test_a_write_of_a_retired_rate_facet_is_refused(tmp_path: Path, legacy: str) -> None:
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({legacy: RETIRED[legacy]})


@pytest.mark.parametrize("legacy", sorted(RETIRED))
def test_a_stored_retired_rate_facet_does_not_surface_on_read(tmp_path: Path, legacy: str) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, set_to(legacy, RETIRED[legacy]))
    assert legacy not in store_at(tmp_path).read()


def drop_new_switches(facets: dict[str, Any]) -> None:
    """A `edit_facets` mutation shaping the file an older HQPTuner left: the
    retired facets present, the switches that replaced them absent."""
    for key in ("hide_limited", "odd_rate_only", "downsafe_only"):
        facets.pop(key, None)
    facets.update(RETIRED)


@pytest.mark.parametrize(
    ("switch", "default"),
    [("hide_limited", "auto"), ("odd_rate_only", False), ("downsafe_only", False)],
)
def test_a_legacy_rate_file_reads_the_replacement_switch_at_its_default(
    tmp_path: Path, switch: str, default: object
) -> None:
    path = stored(tmp_path, SET)
    edit_facets(path, drop_new_switches)
    assert store_at(tmp_path).read()[switch] == default


def test_a_partial_switch_write_answers_with_all_three_switches_present(tmp_path: Path) -> None:
    answered = store_at(tmp_path).write({"hide_limited": "on"})
    assert {"hide_limited", "odd_rate_only", "downsafe_only"} <= answered.keys()


# The cap is on the list's length exactly as given: the store does not
# deduplicate before counting, so a list of one repeated in-domain token is
# accepted at 32 entries and refused at 33.
@pytest.mark.parametrize("facet", ["genre", "focus"])
def test_a_write_of_more_than_32_entries_is_refused(tmp_path: Path, facet: str) -> None:
    value = "rock" if facet == "genre" else "timbre"
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({facet: [value] * 33})


@pytest.mark.parametrize("facet", ["genre", "focus"])
def test_a_write_of_exactly_32_entries_reads_back_whole(tmp_path: Path, facet: str) -> None:
    value = "rock" if facet == "genre" else "timbre"
    store = store_at(tmp_path)
    store.write({facet: [value] * 32})
    assert store.read()[facet] == [value] * 32


# --- the on-disk layout stamp ------------------------------------------------


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    restamp(stored(tmp_path, SET), TOO_NEW)
    with pytest.raises(NarrowingSchemaError, match=str(TOO_NEW)):
        store_at(tmp_path).read()


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_write(tmp_path: Path) -> None:
    restamp(stored(tmp_path, SET), TOO_NEW)
    with pytest.raises(NarrowingSchemaError, match=str(TOO_NEW)):
        store_at(tmp_path).write(SET)


def test_a_refused_write_leaves_the_newer_file_untouched(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the on-disk check.
    path = stored(tmp_path, SET)
    restamp(path, TOO_NEW)
    before = path.read_text()
    with contextlib.suppress(NarrowingError):
        store_at(tmp_path).write({"quality": 3})
    assert path.read_text() == before


def test_the_schema_refusal_is_caught_by_a_caller_catching_the_general_error(tmp_path: Path) -> None:
    restamp(stored(tmp_path, SET), TOO_NEW)
    with pytest.raises(NarrowingError):
        store_at(tmp_path).read()


def test_an_unstamped_file_is_read_rather_than_refused(tmp_path: Path) -> None:
    unstamp(stored(tmp_path, SET))
    assert store_at(tmp_path).read()["phase"] == "linear"


# Any stamp at all is not enough: the number a write puts on the file has to be
# one this version's `read` accepts, or the next start refuses its own file. The
# stamp the write left is lifted off and put on a second file, which is then
# read: a missing stamp raises `KeyError` here, and a stamp this version refuses
# raises `NarrowingSchemaError`.
def test_an_unstamped_file_carries_a_stamp_after_the_next_write(tmp_path: Path) -> None:
    path = stored(tmp_path, SET)
    unstamp(path)
    store_at(tmp_path).write({"quality": 3})
    stamp = json.loads(path.read_text())["schema"]
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    restamp(stored(elsewhere, {"phase": "minimum"}), stamp)
    assert store_at(elsewhere).read()["phase"] == "minimum"


# --- the REST pair -----------------------------------------------------------


def test_a_fresh_install_answers_get_with_every_facet_at_its_default(nar_client: TestClient) -> None:
    assert nar_client.get("/api/narrowing").json()["facets"] == DEFAULTS


def test_a_fresh_install_answers_get_with_200(nar_client: TestClient) -> None:
    assert nar_client.get("/api/narrowing").status_code == 200


def test_put_answers_200(nar_client: TestClient) -> None:
    assert nar_client.put("/api/narrowing", json={"facets": SET}).status_code == 200


def test_put_answers_with_the_stored_facets_so_no_follow_up_get_is_needed(nar_client: TestClient) -> None:
    assert nar_client.put("/api/narrowing", json={"facets": SET}).json()["facets"] == SET


def test_put_then_get_answers_with_the_stored_facets(nar_client: TestClient) -> None:
    nar_client.put("/api/narrowing", json={"facets": SET})
    assert nar_client.get("/api/narrowing").json()["facets"] == SET


@pytest.mark.parametrize("facet", sorted(OUT_OF_DOMAIN))
def test_a_put_of_an_out_of_domain_facet_answers_422(nar_client: TestClient, facet: str) -> None:
    body = {"facets": {facet: OUT_OF_DOMAIN[facet]}}
    assert nar_client.put("/api/narrowing", json=body).status_code == 422


def test_a_put_carrying_a_key_that_is_not_a_facet_answers_422(nar_client: TestClient) -> None:
    assert nar_client.put("/api/narrowing", json={"facets": {"wombat": "yes"}}).status_code == 422


def test_get_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, narrowing_api: Callable[[], TestClient]
) -> None:
    restamp(stored(tmp_path, SET), TOO_NEW)
    assert narrowing_api().get("/api/narrowing").status_code == 409


def test_put_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, narrowing_api: Callable[[], TestClient]
) -> None:
    restamp(stored(tmp_path, SET), TOO_NEW)
    assert narrowing_api().put("/api/narrowing", json={"facets": SET}).status_code == 409
