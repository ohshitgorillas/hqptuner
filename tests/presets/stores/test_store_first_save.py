"""The first save of each store lands when the directory its file goes in, and that directory's parent, do not exist.

Characterization of behavior that already exists.

A fresh install, or one whose state directory a user moved, has nothing on disk
under the paths ``Config`` names. Each case points one store two missing levels
deep under ``tmp_path``, saves into it once through the store's own surface,
and reads the value back through a store opened afresh over the same path, the
way the next start of the app would.
"""

import io
from collections.abc import Callable
from pathlib import Path

import pytest
from state_import import favorites, zip_of
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets.store import stateimport
from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore
from hqptuner.presets.store.presets import PresetStore

PRESET = "Den"
FILTER = "poly-sinc-gauss-long"
DESCRIPTION = "Warm, for late evenings."
MODE = "headphones"
GENRES = ["jazz"]
SNAPSHOT = "alpha"
RECORD = LiveRecord(chain="pcm", fields={"filter": "12"})
BACKUP = b"pre-apply-backup-bytes-41d9"

#: The state limit an imported archive is checked against: far past the few dozen bytes it holds.
STATE_LIMIT = 4096


def missing(tmp_path: Path) -> Path:
    """A directory under ``tmp_path`` that does not exist, and whose parent does not exist either."""
    return tmp_path / "missing-parent" / "missing-dir"


def save_backup(tmp_path: Path) -> None:
    cfg = Config(backup_dir=missing(tmp_path), preset_dir=tmp_path / "presets")
    ConnectionManager(cfg, clock=VirtualClock()).presetops.persist_backup_for_apply(BACKUP)


def read_backups(tmp_path: Path) -> object:
    return [path.read_bytes() for path in sorted(missing(tmp_path).rglob("*")) if path.is_file()]


def save_description(tmp_path: Path) -> None:
    DescriptionStore(missing(tmp_path) / "descriptions.json").write(PRESET, DESCRIPTION)


def read_description(tmp_path: Path) -> object:
    entry = DescriptionStore(missing(tmp_path) / "descriptions.json").read().get(PRESET)
    return entry["text"] if entry else None


def save_autopilot(tmp_path: Path) -> None:
    AutopilotStore(missing(tmp_path) / "autopilot.json").set_for_preset(PRESET, enabled=True)


def read_autopilot(tmp_path: Path) -> object:
    return AutopilotStore(missing(tmp_path) / "autopilot.json").for_preset(PRESET)


def save_matrix_mode(tmp_path: Path) -> None:
    MatrixModeStore(missing(tmp_path) / "matrixmodes.json").write(PRESET, MODE)


def read_matrix_mode(tmp_path: Path) -> object:
    return MatrixModeStore(missing(tmp_path) / "matrixmodes.json").read().get(PRESET)


def save_snapshot(tmp_path: Path) -> None:
    LivePresetStore(missing(tmp_path) / "live-presets.json", stations=list).save(SNAPSHOT, RECORD, [""])


def read_snapshot(tmp_path: Path) -> object:
    return LivePresetStore(missing(tmp_path) / "live-presets.json", stations=list).all("").get(SNAPSHOT)


def save_narrowing(tmp_path: Path) -> None:
    NarrowingStore(missing(tmp_path) / "narrowing.json").write({"genre": GENRES})


def read_narrowing(tmp_path: Path) -> object:
    return NarrowingStore(missing(tmp_path) / "narrowing.json").read().genre


def save_favorites(tmp_path: Path) -> None:
    FavoriteStore(missing(tmp_path) / "favorites.json").write([FILTER])


def read_favorites(tmp_path: Path) -> object:
    return FavoriteStore(missing(tmp_path) / "favorites.json").read()


def import_favorites(tmp_path: Path) -> None:
    """Import an archive carrying FILTER as the only favorite, into an install whose favorites file is missing."""
    cfg = Config(favorites_file=missing(tmp_path) / "favorites.json")
    upload = stateimport.read_upload(io.BytesIO(zip_of({"favorites.json": favorites(FILTER)})), STATE_LIMIT)
    carried = stateimport.check(upload, STATE_LIMIT)
    stateimport.replace_stores(cfg, carried, PresetStore(tmp_path / "presets"))


#: Each store: its first save, its read through a fresh store, and the value that read finds.
FIRST_SAVES: list[object] = [
    pytest.param(save_backup, read_backups, [BACKUP], id="preset-backups"),
    pytest.param(save_description, read_description, DESCRIPTION, id="descriptions"),
    pytest.param(save_autopilot, read_autopilot, True, id="auto-pilot"),
    pytest.param(save_matrix_mode, read_matrix_mode, MODE, id="matrix-modes"),
    pytest.param(save_snapshot, read_snapshot, RECORD, id="live-snapshots"),
    pytest.param(save_narrowing, read_narrowing, GENRES, id="narrowing"),
    pytest.param(save_favorites, read_favorites, [FILTER], id="favorites"),
    pytest.param(import_favorites, read_favorites, [FILTER], id="state-import"),
]


@pytest.mark.parametrize(("save", "read", "expected"), FIRST_SAVES)
def test_a_first_save_lands_where_neither_the_directory_nor_its_parent_exists(
    tmp_path: Path, save: Callable[[Path], None], read: Callable[[Path], object], expected: object
) -> None:
    save(tmp_path)
    assert read(tmp_path) == expected
