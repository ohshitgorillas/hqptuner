"""The REST pair over `MatrixModeStore`: GET/PUT `/api/matrixmodes`, which is how
the browser learns and records which half of the Matrix tab a preset is for.

The store itself — reading, writing, the mode and name rules, a foreign file —
is pinned in ``tests/presets/test_matrix_mode_store.py``. The suite is cut there
because everything in this file needs an app and a client and nothing in the
store file does.

A mode is keyed by preset NAME, the stable join key (docs/architecture.md §2),
and lives in HQPTuner's own state because hqplayerd re-serializes its config from
its own model and would drop an attribute of ours (docs/matrix-spec.md:31). So
the pair never touches hqplayerd: the client below is built with no credentials
and a control lane pointed at a closed port, and a route that answers at all
answered without the daemon.

Every store file lands under pytest's ``tmp_path``, never in the repo's state
dir. The on-disk layout — ``{"schema": N, "presets": {name: mode}}`` — is the
contract a DIFFERENT HQPTuner version reads, so the case about a foreign file
hand-writes one.
"""

import json
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = {"schema": 99, "presets": {"Night": "headphones"}}

NAME = "Night"
OTHER = "Studio"
PATH = "/api/matrixmodes"


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "matrixmodes.json"
    path.write_text(content)
    return path


@pytest.fixture
def matrixmodes_api(tmp_path: Path, closed_port: int) -> Iterator[Callable[[], TestClient]]:
    """The REST surface over a matrix-mode file in ``tmp_path``, daemonless.

    A factory rather than a plain client so a case can hand-write a file another
    HQPTuner version stamped and then open the app over it."""
    clients: list[TestClient] = []

    def build() -> TestClient:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_username="",
            hqp_password="",
            matrix_mode_file=tmp_path / "matrixmodes.json",
        )
        client = TestClient(create_app(cfg))
        clients.append(client)
        client.__enter__()
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def modes_client(matrixmodes_api: Callable[[], TestClient]) -> TestClient:
    return matrixmodes_api()


# --- an install that has stored nothing ------------------------------------------


def test_a_fresh_install_answers_get_with_200(modes_client: TestClient) -> None:
    assert modes_client.get(PATH).status_code == 200


# --- the round trip ----------------------------------------------------------------


@pytest.mark.parametrize("mode", [pytest.param("speakers", id="speakers"), pytest.param("headphones", id="headphones")])
def test_put_then_get_answers_with_the_stored_mode(modes_client: TestClient, mode: str) -> None:
    modes_client.put(PATH, json={"name": NAME, "mode": mode})
    assert modes_client.get(PATH).json()["presets"][NAME] == mode


def test_a_put_that_stores_a_mode_answers_200(modes_client: TestClient) -> None:
    assert modes_client.put(PATH, json={"name": NAME, "mode": "speakers"}).status_code == 200


def test_put_answers_with_the_mode_it_just_stored(modes_client: TestClient) -> None:
    answer = modes_client.put(PATH, json={"name": NAME, "mode": "speakers"})
    assert answer.json()["presets"][NAME] == "speakers"


def test_put_answers_with_the_whole_map_so_no_follow_up_get_is_needed(modes_client: TestClient) -> None:
    modes_client.put(PATH, json={"name": OTHER, "mode": "headphones"})
    answer = modes_client.put(PATH, json={"name": NAME, "mode": "speakers"})
    assert sorted(answer.json()["presets"]) == ["Night", "Studio"]


def test_a_put_leaves_another_presets_mode_alone(modes_client: TestClient) -> None:
    modes_client.put(PATH, json={"name": OTHER, "mode": "headphones"})
    modes_client.put(PATH, json={"name": NAME, "mode": "speakers"})
    assert modes_client.get(PATH).json()["presets"][OTHER] == "headphones"


# --- a mode that is neither half of the tab ------------------------------------------


@pytest.mark.parametrize(
    "mode",
    [
        pytest.param("", id="empty"),
        pytest.param("Speakers", id="capitalized"),
        pytest.param("speaker", id="singular"),
        pytest.param("stereo", id="unknown-word"),
        pytest.param(" headphones", id="leading-space"),
    ],
)
def test_a_put_carrying_a_mode_that_is_not_a_half_of_the_tab_answers_422(modes_client: TestClient, mode: str) -> None:
    assert modes_client.put(PATH, json={"name": NAME, "mode": mode}).status_code == 422


# --- a name the store refuses ------------------------------------------------------------
# The store's name rule is pinned in the store's own suite; what is pinned here
# is that the route turns a refusal into a refusal the browser can read, and not
# into a 500.


@pytest.mark.parametrize(
    "name",
    [
        pytest.param("", id="empty"),
        pytest.param(" ", id="only-whitespace"),
        pytest.param("a/b", id="forward-slash"),
        pytest.param("..", id="parent-directory"),
        pytest.param(".hidden", id="leading-dot"),
        pytest.param("Night ", id="trailing-space"),
    ],
)
def test_a_put_carrying_a_name_the_store_refuses_answers_422(modes_client: TestClient, name: str) -> None:
    assert modes_client.put(PATH, json={"name": name, "mode": "speakers"}).status_code == 422


def test_a_refused_put_stores_nothing(modes_client: TestClient) -> None:
    modes_client.put(PATH, json={"name": NAME, "mode": "stereo"})
    assert modes_client.get(PATH).json()["presets"] == {}


# --- a store stamped by a newer HQPTuner ------------------------------------------------
# An empty map would be a lie about a file that is there and full, and the lie
# puts the user on the wrong half of the tab.


def test_get_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, matrixmodes_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert matrixmodes_api().get(PATH).status_code == 409


# --- the mode map against the preset store it joins to -----------------------------------
# The cases above build an app over a matrix-mode file alone, so the preset
# store behind them is whatever the host happened to leave lying around. The
# fixture below pins both halves under ``tmp_path``: a preset store this file
# seeds by name, and the mode file beside it. Preset names are the join key
# (docs/architecture.md §2), so a mode for a name no preset carries is an orphan
# nothing can ever display.

#: Opaque bytes; the preset store never parses a payload (test_presetstore.py).
PRESET_PAYLOAD = b"<hqplayerd/>"

#: The preset store's own on-disk layout stamp, in a version this build cannot read.
TOO_NEW_PRESET_STORE = {"schema": 99}

GHOST = "Ghost"
DELETE_PATH = "/api/profile/delete"


@pytest.fixture
def preset_dir(tmp_path: Path) -> Path:
    """Where the preset store the mode map joins against lives."""
    return tmp_path / "presets"


@pytest.fixture
def joined_api(tmp_path: Path, preset_dir: Path, closed_port: int) -> Iterator[Callable[..., TestClient]]:
    """The REST surface over a mode file AND a preset store, both in ``tmp_path``.

    A factory taking the preset names to seed, so a case can decide what exists
    before the app opens — including nothing at all, over a preset store
    directory the case hand-wrote itself."""
    clients: list[TestClient] = []

    def build(names: Sequence[str] = ()) -> TestClient:
        store = PresetStore(preset_dir)
        for name in names:
            store.save(name, PRESET_PAYLOAD)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_username="",
            hqp_password="",
            matrix_mode_file=tmp_path / "matrixmodes.json",
            preset_dir=preset_dir,
        )
        client = TestClient(create_app(cfg))
        clients.append(client)
        client.__enter__()
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


def test_a_put_for_a_name_no_preset_carries_leaves_the_map_holding_only_the_real_one(
    joined_api: Callable[..., TestClient],
) -> None:
    client = joined_api([NAME])
    client.put(PATH, json={"name": NAME, "mode": "speakers"})
    client.put(PATH, json={"name": GHOST, "mode": "speakers"})
    assert client.get(PATH).json()["presets"] == {NAME: "speakers"}


@pytest.mark.parametrize(
    ("mode", "status"),
    [pytest.param("stereo", 422, id="unstorable-mode"), pytest.param("speakers", 404, id="storable-mode")],
)
def test_a_put_for_a_name_no_preset_carries_answers_on_the_mode_before_the_name(
    joined_api: Callable[..., TestClient], mode: str, status: int
) -> None:
    client = joined_api([NAME])
    assert client.put(PATH, json={"name": GHOST, "mode": mode}).status_code == status


def test_deleting_a_preset_drops_its_mode_and_leaves_the_other_presets_mode(
    joined_api: Callable[..., TestClient],
) -> None:
    client = joined_api([NAME, OTHER])
    client.put(PATH, json={"name": NAME, "mode": "speakers"})
    client.put(PATH, json={"name": OTHER, "mode": "headphones"})
    client.post(DELETE_PATH, json={"name": NAME})
    assert client.get(PATH).json()["presets"] == {OTHER: "headphones"}


def test_a_put_against_a_preset_store_stamped_by_a_newer_hqptuner_answers_422(
    preset_dir: Path, joined_api: Callable[..., TestClient]
) -> None:
    preset_dir.mkdir()
    (preset_dir / "store.json").write_text(json.dumps(TOO_NEW_PRESET_STORE))
    assert joined_api().put(PATH, json={"name": NAME, "mode": "speakers"}).status_code == 422
