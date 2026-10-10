"""A read or a delete the filesystem refuses in one of HQPTuner's own stores,
or a write it refuses to the audit log, answers a JSON error whose `detail`
names the path and the operating system's own reason, never the generic
unexpected-error answer.

Covered here: the parked filter uploads (listed by an upload, read and then
cleared by the apply that injects them), a preset's own file (read by its
preview and by its load), the state export, and the audit log. Each case takes the read or the write bit
away from one path the fixture configured, after the app has started, so the
operating system refuses that one operation with `EACCES`, then drives the
route that needs it.

The sentence around the path and the reason is copy (docs/testing.md rule 9)
and is not asserted. The path is the fixture's and the reason is the operating
system's own text for the errno the fixture provoked, so both may be asserted
inside `detail`. `store_unwritable` is the code docs/architecture.md §8.1 gives
a store read or write the filesystem refused; `internal_error` is the code of
the generic unexpected-error answer.
"""

import errno
import json
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

#: The operating system's own words for the refusal every case provokes.
OS_REASON = os.strerror(errno.EACCES)

STORE_CODE = "store_unwritable"
GENERIC_CODE = "internal_error"

#: What `field` reads off a body that is not a JSON object or lacks the key.
ABSENT = ""

#: Modes the cases lock a path with: a directory that can be entered and written
#: but not listed, one that can be listed and entered but not written, and a
#: file nobody may open.
UNLISTABLE_DIR = 0o300
UNWRITABLE_DIR = 0o555
UNREADABLE_FILE = 0o000
OPEN_DIR = 0o755
OPEN_FILE = 0o644

PRESET = "Night"
PRESET_PAYLOAD = b"<hqplayerd/>"
FAVORITES = {"schema": 1, "filters": ["sinc-M"]}
UPLOAD = {"file": ("room.wav", minimal_wave(), "application/octet-stream")}
STAGED_TITLE = {"http": {"title": "Renamed"}}


@dataclass(frozen=True)
class Refusal:
    """What the route answered, beside the path the fixture locked."""

    response: Response
    path: Path


class Scene:
    """The app over a state area in ``root``; every path locked here is opened
    again on teardown so the temporary tree can be removed."""

    def __init__(self, root: Path, http_port: int, control_port: int, stack: ExitStack) -> None:
        self.backup_dir = root / "backups"
        self.park = self.backup_dir / "pending-filters"
        self.preset_dir = root / "presets"
        self.favorites = root / "favorites.json"
        self.audit_log = root / "locked" / "audit.jsonl"
        self.audited = False
        self._root = root
        self._ports = (http_port, control_port)
        self._stack = stack

    def start(self) -> TestClient:
        http_port, control_port = self._ports
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control_port,
            hqp_http_port=http_port,
            hqp_username="u",
            hqp_password="p",
            alarm_threshold=1.0,
            hqp_home="/x/home",
            backup_dir=self.backup_dir,
            preset_dir=self.preset_dir,
            live_preset_file=self._root / "live-presets.json",
            favorites_file=self.favorites,
            narrowing_file=self._root / "narrowing.json",
            description_file=self._root / "descriptions.json",
            matrix_mode_file=self._root / "matrixmodes.json",
            autopilot_file=self._root / "autopilot.json",
            connection_file=self._root / "connection.json",
            debug_log=self.audit_log if self.audited else None,
        )
        # an unhandled OSError comes back as the 500 a browser sees rather than
        # being raised into the case
        return self._stack.enter_context(TestClient(create_app(cfg, VirtualClock()), raise_server_exceptions=False))

    def lock(self, path: Path, mode: int, still_allowed: Callable[[Path], object]) -> Path:
        """Give ``path`` ``mode``, and skip the case when ``still_allowed`` goes
        through anyway, which is how a root process sees a cleared bit."""
        self._stack.callback(path.chmod, OPEN_DIR if path.is_dir() else OPEN_FILE)
        path.chmod(mode)
        try:
            still_allowed(path)
        except PermissionError:
            return path
        pytest.skip("this process reads and writes through cleared permission bits (running as root)")

    def lock_files_in(self, directory: Path) -> Path:
        for member in sorted(p for p in directory.rglob("*") if p.is_file()):
            self.lock(member, UNREADABLE_FILE, Path.read_bytes)
        return directory


def _touch_probe(directory: Path) -> None:
    probe = directory / ".probe"
    probe.touch()
    probe.unlink()


def _list(directory: Path) -> list[Path]:
    return list(directory.iterdir())


def upload_beside_an_unlistable_park(scene: Scene) -> Refusal:
    scene.park.mkdir(parents=True)
    client = scene.start()
    scene.lock(scene.park, UNLISTABLE_DIR, _list)
    return Refusal(client.post("/api/matrix/filter", files=UPLOAD), scene.park)


def apply_with_an_unreadable_parked_upload(scene: Scene) -> Refusal:
    client = scene.start()
    client.post("/api/matrix/filter", files=UPLOAD)
    scene.lock_files_in(scene.park)
    client.post("/api/config/stage", json=STAGED_TITLE)
    return Refusal(client.post("/api/config/apply"), scene.park)


def apply_that_cannot_clear_the_park(scene: Scene) -> Refusal:
    client = scene.start()
    client.post("/api/matrix/filter", files=UPLOAD)
    scene.lock(scene.park, UNWRITABLE_DIR, _touch_probe)
    client.post("/api/config/stage", json=STAGED_TITLE)
    return Refusal(client.post("/api/config/apply"), scene.park)


def _preset_file(scene: Scene) -> Path:
    """The one file under the preset store that carries the saved payload.

    The store's naming of a preset's file is not a contract, so the file is
    found by its bytes rather than by a name built here."""
    (only,) = (p for p in scene.preset_dir.rglob("*") if p.is_file() and PRESET_PAYLOAD in p.read_bytes())
    return only


def preview_of_an_unreadable_preset(scene: Scene) -> Refusal:
    PresetStore(scene.preset_dir).save(PRESET, PRESET_PAYLOAD)
    client = scene.start()
    locked = scene.lock(_preset_file(scene), UNREADABLE_FILE, Path.read_bytes)
    return Refusal(client.get(f"/api/preset/{PRESET}"), locked)


def load_of_an_unreadable_preset(scene: Scene) -> Refusal:
    PresetStore(scene.preset_dir).save(PRESET, PRESET_PAYLOAD)
    client = scene.start()
    locked = scene.lock(_preset_file(scene), UNREADABLE_FILE, Path.read_bytes)
    return Refusal(client.post("/api/profile/load", json={"name": PRESET}), locked)


def export_of_an_unreadable_store_file(scene: Scene) -> Refusal:
    scene.favorites.write_text(json.dumps(FAVORITES))
    client = scene.start()
    scene.lock(scene.favorites, UNREADABLE_FILE, Path.read_bytes)
    return Refusal(client.get("/api/state-export"), scene.favorites)


def stage_into_an_unwritable_audit_log(scene: Scene) -> Refusal:
    scene.audit_log.parent.mkdir(parents=True)
    scene.audited = True
    client = scene.start()
    scene.lock(scene.audit_log.parent, UNWRITABLE_DIR, _touch_probe)
    return Refusal(client.post("/api/config/stage", json=STAGED_TITLE), scene.audit_log)


Drive = Callable[[Scene], Refusal]

STORE_CASES: list[Any] = [
    pytest.param(upload_beside_an_unlistable_park, id="park-listing"),
    pytest.param(apply_with_an_unreadable_parked_upload, id="park-read"),
    pytest.param(apply_that_cannot_clear_the_park, id="park-clear"),
    pytest.param(preview_of_an_unreadable_preset, id="preset-preview"),
    pytest.param(load_of_an_unreadable_preset, id="preset-load"),
    pytest.param(export_of_an_unreadable_store_file, id="state-export"),
]
AUDIT_CASE: Any = pytest.param(stage_into_an_unwritable_audit_log, id="audit-write")
EVERY_CASE: list[Any] = [*STORE_CASES, AUDIT_CASE]


@pytest.fixture
def scene(tmp_path: Path, http_daemon: dict[str, Any], closed_port: int) -> Iterator[Scene]:
    with ExitStack() as stack:
        yield Scene(tmp_path, http_daemon["_port"], closed_port, stack)


def field(response: Response, key: str) -> str:
    """One string field of a JSON object body, or ``ABSENT``."""
    try:
        body = response.json()
    except ValueError:
        return ABSENT
    value = body.get(key) if isinstance(body, dict) else None
    return value if isinstance(value, str) else ABSENT


@pytest.mark.parametrize("drive", STORE_CASES)
def test_a_store_read_or_delete_the_filesystem_refuses_answers_code_store_unwritable(
    scene: Scene, drive: Drive
) -> None:
    assert field(drive(scene).response, "code") == STORE_CODE


@pytest.mark.parametrize("drive", [AUDIT_CASE])
def test_an_audit_write_the_filesystem_refuses_answers_an_error_other_than_the_generic_one(
    scene: Scene, drive: Drive
) -> None:
    assert field(drive(scene).response, "code") not in {ABSENT, GENERIC_CODE}


@pytest.mark.parametrize("drive", EVERY_CASE)
def test_a_refused_read_delete_or_audit_write_names_the_path(scene: Scene, drive: Drive) -> None:
    refusal = drive(scene)
    assert str(refusal.path) in field(refusal.response, "detail")


@pytest.mark.parametrize("drive", EVERY_CASE)
def test_a_refused_read_delete_or_audit_write_gives_the_operating_systems_reason(scene: Scene, drive: Drive) -> None:
    assert OS_REASON in field(drive(scene).response, "detail")
