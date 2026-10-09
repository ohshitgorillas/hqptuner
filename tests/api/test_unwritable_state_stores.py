"""A store write the filesystem refuses answers `store_unwritable`, and its
`detail` names where the save was going and the operating system's own reason.

Covered here: the description, matrix-mode and auto-pilot JSON stores, the
filter park behind `POST /api/matrix/filter`, and the connection record. Each
case points one store at a directory with its write bit cleared, so creating a
file there is refused with `EACCES` while reading it still works, then drives
that store's own write route.

The sentence wrapped around the path and the reason is copy (docs/testing.md
rule 9) and is not asserted. The path is the one the fixture configured and the
reason is the operating system's own text for the errno the fixture provoked,
so both are the fixture's and may be asserted inside `detail`.
"""

import errno
import os
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from conftest import minimal_wave
from fastapi.testclient import TestClient
from httpx import Response
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore

#: The errno a directory without its write bit gives a non-root writer.
REFUSED_ERRNO = errno.EACCES

#: The operating system's own description of that errno.
OS_REASON = os.strerror(REFUSED_ERRNO)

UNWRITABLE_CODE = "store_unwritable"

#: Directory mode with every write bit cleared.
READ_ONLY_DIR = 0o555
WRITABLE_DIR = 0o755

NAME = "Night"
TEXT = "Wide stereo, gentle tilt below 200 Hz."

#: Opaque bytes; the preset store never parses a payload.
PRESET_PAYLOAD = b"<hqplayerd/>"


@dataclass(frozen=True)
class Refusal:
    """What a store's write route answered, and where the fixture had pointed
    that store."""

    response: Response
    path: Path


class Rig:
    """Builds the app over a state area in ``tmp_path`` with one store pointed
    into a locked directory, and unlocks every such directory on teardown."""

    def __init__(self, tmp_path: Path, http_port: int, closed_port: int, stack: ExitStack) -> None:
        self.state = tmp_path / "state"
        self.state.mkdir()
        self.backup_dir = self.state / "backups"
        self.preset_dir = self.state / "presets"
        self._tmp_path = tmp_path
        self._stack = stack
        #: What the app is built on; a case points one store into a locked
        #: directory here before it calls `client`.
        self.config = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_http_port=http_port,
            hqp_username="u",
            hqp_password="p",
            alarm_threshold=1.0,
            hqp_home="/x/home",
            backup_dir=self.backup_dir,
            preset_dir=self.preset_dir,
            live_preset_file=self.state / "live-presets.json",
            favorites_file=self.state / "favorites.json",
            narrowing_file=self.state / "narrowing.json",
            description_file=self.state / "descriptions.json",
            matrix_mode_file=self.state / "matrixmodes.json",
            autopilot_file=self.state / "autopilot.json",
            connection_file=self.state / "connection.json",
        )

    def lock(self, directory: Path) -> Path:
        """``directory``, created and then made unwritable. Skips the case when
        the filesystem still lets this process write there, which is how a
        root writer sees a cleared write bit."""
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(READ_ONLY_DIR)
        self._stack.callback(directory.chmod, WRITABLE_DIR)
        probe = directory / ".probe"
        try:
            probe.touch()
        except PermissionError:
            return directory
        probe.unlink()
        pytest.skip("this process writes through a cleared directory write bit (running as root)")

    def locked_file(self, name: str) -> Path:
        return self.lock(self._tmp_path / "locked") / name

    def client(self) -> TestClient:
        # an unguarded OSError must come back as the bare 500 a client sees,
        # not be re-raised into the test
        app = create_app(self.config, VirtualClock())
        return self._stack.enter_context(TestClient(app, raise_server_exceptions=False))


@pytest.fixture
def rig(tmp_path: Path, http_daemon: dict[str, Any], closed_port: int) -> Iterator[Rig]:
    with ExitStack() as stack:
        yield Rig(tmp_path, http_daemon["_port"], closed_port, stack)


def refused_description(rig: Rig) -> Refusal:
    path = rig.locked_file("descriptions.json")
    rig.config.description_file = path
    client = rig.client()
    return Refusal(client.put("/api/descriptions", json={"name": NAME, "text": TEXT}), path)


def refused_matrix_mode(rig: Rig) -> Refusal:
    PresetStore(rig.preset_dir).save(NAME, PRESET_PAYLOAD)  # a mode is stored only for a preset that exists
    path = rig.locked_file("matrixmodes.json")
    rig.config.matrix_mode_file = path
    client = rig.client()
    return Refusal(client.put("/api/matrixmodes", json={"name": NAME, "mode": "speakers"}), path)


def refused_autopilot(rig: Rig) -> Refusal:
    path = rig.locked_file("autopilot.json")
    rig.config.autopilot_file = path
    rig.config.advisor_enabled = True
    client = rig.client()
    return Refusal(client.post("/api/autopilot", json={"enabled": True}), path)


def refused_filter_park(rig: Rig) -> Refusal:
    park = rig.lock(rig.backup_dir / "pending-filters")
    client = rig.client()
    upload = {"file": ("probe.wav", minimal_wave(), "application/octet-stream")}
    return Refusal(client.post("/api/matrix/filter", files=upload), park)


def refused_connection(rig: Rig) -> Refusal:
    path = rig.locked_file("connection.json")
    rig.config.connection_file = path
    client = rig.client()
    body = {"host": "127.0.0.1", "username": "u", "password": "p", "remember": True}
    return Refusal(client.post("/api/connection", json=body), path)


RefusedWrite = Callable[[Rig], Refusal]

EVERY_STORE: list[Any] = [
    pytest.param(refused_description, id="descriptions"),
    pytest.param(refused_matrix_mode, id="matrix-modes"),
    pytest.param(refused_autopilot, id="autopilot"),
    pytest.param(refused_filter_park, id="filter-park"),
    pytest.param(refused_connection, id="connection"),
]


def body_field(response: Response, key: str) -> object:
    """One field of a JSON object body, or None when the body is not one."""
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    return body.get(key)


@pytest.mark.parametrize("refused_write", EVERY_STORE)
def test_a_store_write_the_filesystem_refuses_answers_code_store_unwritable(
    rig: Rig, refused_write: RefusedWrite
) -> None:
    assert body_field(refused_write(rig).response, "code") == UNWRITABLE_CODE


@pytest.mark.parametrize("refused_write", EVERY_STORE)
def test_a_refused_store_write_names_where_the_save_was_going(rig: Rig, refused_write: RefusedWrite) -> None:
    refusal = refused_write(rig)
    assert str(refusal.path) in str(body_field(refusal.response, "detail"))


@pytest.mark.parametrize("refused_write", EVERY_STORE)
def test_a_refused_store_write_gives_the_operating_systems_reason(rig: Rig, refused_write: RefusedWrite) -> None:
    assert OS_REASON in str(body_field(refused_write(rig).response, "detail"))
