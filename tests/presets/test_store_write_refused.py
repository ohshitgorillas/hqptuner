"""A store write the filesystem refuses answers the REST code `store_unwritable`.

Covers the stores HQPTuner owns under `presets/store/`: the preset directory, the
live-snapshot file, the favorites file and the narrowing file. Each is given its
own directory under `tmp_path`, and the case takes write permission off that one
directory (and the files already in it) before the request, so the operating
system refuses the write with `EACCES` and every other store stays writable.

Every request goes through the REST routes of an app on the fake 8088 daemon and
the threaded 4321 fake; nothing in `hqptuner/` is stubbed. The `detail` sentence
is copy (docs/testing.md rule 9), so the cases read only what the fixture or the
operating system put there: the store's location and the OS's own description
of the errno.
"""

import errno
import os
import stat
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from apps import METADATA_MIN, wait_for_api
from fastapi.testclient import TestClient
from httpx import Response
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The errno a write into a directory without write permission is refused with.
REFUSAL = errno.EACCES

#: The operating system's own wording for that errno.
OS_REASON = os.strerror(REFUSAL)

#: Read and search only, so the store can still be read but nothing in it written.
READ_ONLY_DIR = stat.S_IRUSR | stat.S_IXUSR
READ_ONLY_FILE = stat.S_IRUSR
WRITABLE_DIR = stat.S_IRWXU
WRITABLE_FILE = stat.S_IRUSR | stat.S_IWUSR

PRESET = "Kept"
SNAPSHOT = "Warm"


@dataclass(frozen=True)
class Stores:
    """Each store's own directory, so one can be refused while the rest write."""

    presets: Path
    live: Path
    favorites: Path
    narrowing: Path
    other: Path


def _stores(root: Path) -> Stores:
    stores = Stores(
        presets=root / "presets",
        live=root / "live",
        favorites=root / "favorites",
        narrowing=root / "narrowing",
        other=root / "other",
    )
    for directory in (stores.presets, stores.live, stores.favorites, stores.narrowing, stores.other):
        directory.mkdir()
    return stores


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


@pytest.fixture
def stores(tmp_path: Path) -> Iterator[Stores]:
    built = _stores(tmp_path)
    yield built
    for directory in (built.presets, built.live, built.favorites, built.narrowing, built.other):
        directory.chmod(WRITABLE_DIR)
        for member in directory.iterdir():
            member.chmod(WRITABLE_DIR if member.is_dir() else WRITABLE_FILE)


@pytest.fixture
def client(stores: Stores, http_daemon: dict[str, Any], threaded_daemon_port: int) -> Iterator[TestClient]:
    """Both lanes on the fakes, every store in its own directory under tmp_path."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        data_dir=METADATA_MIN,
        backup_dir=stores.other / "backups",
        preset_dir=stores.presets,
        live_preset_file=stores.live / "live-presets.json",
        favorites_file=stores.favorites / "favorites.json",
        narrowing_file=stores.narrowing / "narrowing.json",
        description_file=stores.other / "descriptions.json",
        matrix_mode_file=stores.other / "matrixmodes.json",
        autopilot_file=stores.other / "autopilot.json",
        advisor_enabled=True,
        hqp_home="/x/home",
    )
    # A server error reaches the case as the response a browser would get, not as a raised exception.
    with TestClient(create_app(cfg, VirtualClock()), raise_server_exceptions=False) as test_client:
        wait_for_api(test_client, _reachable)
        yield test_client


def refuse_writes(directory: Path) -> None:
    """Take write permission off ``directory`` and everything already in it."""
    for member in directory.iterdir():
        member.chmod(READ_ONLY_DIR if member.is_dir() else READ_ONLY_FILE)
    directory.chmod(READ_ONLY_DIR)
    if os.access(directory, os.W_OK):
        pytest.skip("the test runs with privileges that ignore directory permissions")


def body(response: Response) -> dict[str, Any]:
    """The JSON body of an answer, or nothing for the bare-text 500 an escaped exception gets."""
    if not response.headers.get("content-type", "").startswith("application/json"):
        return {}
    answer: dict[str, Any] = response.json()
    return answer


def seeded(response: Response) -> None:
    """A setup write that has to land before the refused one means anything."""
    if response.status_code != 200:
        raise FixtureError(reason=f"setup write answered {response.status_code}")


def _save_preset(client: TestClient, stores: Stores) -> Response:
    refuse_writes(stores.presets)
    answer: Response = client.post("/api/profile/save", json={"name": PRESET})
    return answer


def _delete_preset(client: TestClient, stores: Stores) -> Response:
    seeded(client.post("/api/profile/save", json={"name": PRESET}))
    refuse_writes(stores.presets)
    answer: Response = client.delete(f"/api/preset/{PRESET}")
    return answer


def _load_preset(client: TestClient, stores: Stores) -> Response:
    seeded(client.post("/api/profile/save", json={"name": PRESET}))
    refuse_writes(stores.presets)
    answer: Response = client.post("/api/profile/load", json={"name": PRESET})
    return answer


def _save_snapshot(client: TestClient, stores: Stores) -> Response:
    refuse_writes(stores.live)
    answer: Response = client.put(f"/api/livepresets/{SNAPSHOT}")
    return answer


def _save_favorites(client: TestClient, stores: Stores) -> Response:
    refuse_writes(stores.favorites)
    answer: Response = client.put("/api/favorites", json={"filters": ["poly-sinc-gauss-long"]})
    return answer


def _save_narrowing(client: TestClient, stores: Stores) -> Response:
    refuse_writes(stores.narrowing)
    answer: Response = client.put("/api/narrowing", json={"facets": {"quality": 4}})
    return answer


Write = Callable[[TestClient, Stores], Response]

#: Every write into a refusable store, and which store's directory it lands in.
WRITES: list[tuple[str, Write, Callable[[Stores], Path]]] = [
    ("preset-save", _save_preset, lambda s: s.presets),
    ("preset-delete", _delete_preset, lambda s: s.presets),
    ("preset-load", _load_preset, lambda s: s.presets),
    ("live-snapshot-save", _save_snapshot, lambda s: s.live),
    ("favorites-save", _save_favorites, lambda s: s.favorites),
    ("narrowing-save", _save_narrowing, lambda s: s.narrowing),
]

REFUSED_WRITES = [pytest.param(write, id=case) for case, write, _ in WRITES]
REFUSED_WRITES_AT = [pytest.param(write, where, id=case) for case, write, where in WRITES]


@pytest.mark.parametrize("write", REFUSED_WRITES)
def test_a_store_write_the_filesystem_refuses_answers_code_store_unwritable(
    client: TestClient, stores: Stores, write: Write
) -> None:
    assert body(write(client, stores)).get("code") == "store_unwritable"


@pytest.mark.parametrize(("write", "where"), REFUSED_WRITES_AT)
def test_a_refused_store_write_names_where_it_was_saving(
    client: TestClient, stores: Stores, write: Write, where: Callable[[Stores], Path]
) -> None:
    assert str(where(stores)) in str(body(write(client, stores)).get("detail"))


@pytest.mark.parametrize("write", REFUSED_WRITES)
def test_a_refused_store_write_ends_on_the_operating_systems_own_reason(
    client: TestClient, stores: Stores, write: Write
) -> None:
    assert str(body(write(client, stores)).get("detail")).endswith(f": {OS_REASON}.")
