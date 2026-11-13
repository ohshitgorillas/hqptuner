"""A store write killed partway leaves the previous file whole (docs/testing.md rule 8).

The kill is a real filesystem refusal (``file_growth_refused``): the second write of an identical value is cut one byte
short, after its temp file exists and before it could replace the file. Written in place, that write would leave a
truncated file the store then refuses as corrupt.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_atomic_write import file_growth_refused

from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore
from hqptuner.presets.store.presets import PresetStore

#: One store's write, and its read of everything that write stored.
Driver = tuple[Callable[[], object], Callable[[], object]]


def live(path: Path) -> Driver:
    store = LivePresetStore(path)
    return lambda: store.save("alpha", LiveRecord(chain="chain")), store.all


def favorites(path: Path) -> Driver:
    store = FavoriteStore(path)
    return lambda: store.write(["alpha"]), store.read


def modulators(path: Path) -> Driver:
    store = FavoriteStore(path)
    return lambda: store.write_modulators(["alpha"]), store.read_modulators


def descriptions(path: Path) -> Driver:
    store = DescriptionStore(path, now=lambda: datetime(2026, 1, 1, tzinfo=UTC))
    return lambda: store.write("alpha", "text"), store.read


def autopilot(path: Path) -> Driver:
    store = AutopilotStore(path)
    return lambda: store.set_for_preset("alpha", enabled=True), store.read


def narrowing(path: Path) -> Driver:
    store = NarrowingStore(path)
    return lambda: store.write({}), store.read


def matrixmode(path: Path) -> Driver:
    store = MatrixModeStore(path)
    return lambda: store.write("alpha", "speakers"), store.read


@pytest.mark.parametrize(
    "driver", [live, favorites, modulators, descriptions, autopilot, narrowing, matrixmode], ids=lambda d: d.__name__
)
def test_a_write_killed_partway_leaves_the_store_reading_the_first_write(
    driver: Callable[[Path], Driver], tmp_path: Path
) -> None:
    path = tmp_path / "store.json"
    write, read = driver(path)
    write()
    first = read()
    with file_growth_refused(path.stat().st_size - 1), pytest.raises(OSError):
        write()
    assert read() == first


#: The bytes of the one preset the preset-store cases save.
XML = b"<hqplayerd/>"


def preset_save(root: Path) -> Driver:
    store = PresetStore(root)
    return lambda: store.save("alpha", XML), lambda: store.read("alpha")


def autosave(root: Path) -> Driver:
    store = PresetStore(root)
    return lambda: store.set_autosave(enabled=True), lambda: store.autosave


def active(root: Path) -> Driver:
    store = PresetStore(root)
    return lambda: store.set_active("alpha"), lambda: store.active


@pytest.mark.parametrize("driver", [preset_save, autosave, active], ids=lambda d: d.__name__)
def test_a_preset_store_write_killed_partway_leaves_the_store_answering_the_first_write(
    driver: Callable[[Path], Driver], tmp_path: Path
) -> None:
    write, read = driver(tmp_path)
    write()
    first = read()
    smallest = min(p.stat().st_size for p in tmp_path.rglob("*") if p.is_file())
    with file_growth_refused(smallest - 1), pytest.raises(OSError):
        write()
    assert read() == first
