"""A store write killed partway leaves the previous file whole (docs/testing.md rule 8).

The kill is a real filesystem refusal (``file_growth_refused``): the second write of an identical value is cut one byte
short, after its temp file exists and before it could replace the file. Written in place, that write would leave a
truncated file the store then refuses as corrupt.
"""

import signal
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from types import FrameType
from typing import Any

import pytest
from conftest import ManagerFactory, minimal_wave
from test_atomic_write import file_growth_refused

from hqptuner.atomicwrite import TEMP_SUFFIX
from hqptuner.presets.presetops import BackupBeforeApplyFailedError
from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.filterpark import PARK_DIR
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore
from hqptuner.presets.store.presets import PresetStore
from integrity.test_safety_copies import numbered_archive, stored_copies

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


class Killed(BaseException):
    """What ends a write the process did not survive: no ``OSError`` reaches the code that was writing."""


@contextmanager
def killed_when_file_outgrows(limit: int) -> Iterator[None]:
    """End any write past ``limit`` bytes with ``Killed``, for the block only: the signal the kernel sends for it."""

    def die(_signal: int, _frame: FrameType | None) -> None:
        raise Killed

    before = signal.signal(signal.SIGXFSZ, die)
    try:
        with file_growth_refused(limit):
            yield
    finally:
        signal.signal(signal.SIGXFSZ, before)


async def test_a_safety_copy_killed_partway_leaves_every_stored_copy_alone(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory, tmp_path: Path
) -> None:
    manager = await http_manager_factory(http_daemon)
    archive = numbered_archive(0)
    manager.presetops.persist_backup_for_apply(archive)
    before = stored_copies(tmp_path)
    with killed_when_file_outgrows(len(archive) - 1), pytest.raises(Killed):
        manager.presetops.persist_backup_for_apply(archive)
    assert stored_copies(tmp_path) == before


async def test_a_safety_copy_the_filesystem_refuses_is_reported_as_a_failed_backup(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory
) -> None:
    manager = await http_manager_factory(http_daemon)
    archive = numbered_archive(0)
    with file_growth_refused(len(archive) - 1), pytest.raises(BackupBeforeApplyFailedError):
        manager.presetops.persist_backup_for_apply(archive)


async def test_a_park_write_killed_partway_leaves_no_parked_file(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory
) -> None:
    manager = await http_manager_factory(http_daemon)
    wave = minimal_wave()
    with file_growth_refused(len(wave) - 1), pytest.raises(OSError):
        manager.presetops.park_filter("probe.wav", wave)
    assert manager.presetops.parked_filter_members() == {}


async def test_a_temp_file_left_in_the_park_is_not_a_parked_filter(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory, tmp_path: Path
) -> None:
    manager = await http_manager_factory(http_daemon)
    manager.presetops.park_filter("probe.wav", minimal_wave())
    (tmp_path / PARK_DIR / f".0123456789abcdef{TEMP_SUFFIX}").write_bytes(minimal_wave())
    assert set(manager.presetops.parked_filter_members()) == {"data/probe.wav"}
