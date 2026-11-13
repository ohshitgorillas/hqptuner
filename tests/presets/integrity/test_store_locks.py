"""Two writers to one store both land (docs/testing.md rule 8).

The overlap is forced, never timed. The store is built on a ``pathlib.Path`` subclass that parks the first writer
just before its write begins, holding the snapshot it read. The second writer then starts. A store with no lock lets
the second writer read, write and finish while the first still holds its stale snapshot, and the first write erases
it. A store with a lock makes the second writer wait for the first, so it reads the first one's file. The first writer
is released when the second finishes or finds the store's lock held, so nothing sleeps and nothing waits on a clock.
"""

import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import Self

import pytest

from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.matrixmode import MatrixModeStore


class Overlap:
    """Where two writers meet: the first parks, and the second finishing, or finding the store locked, releases it."""

    def __init__(self) -> None:
        self.first: threading.Thread | None = None
        self.parked = threading.Event()
        self.resolved = threading.Event()
        self.claimed = False

    def arrive(self) -> None:
        """Called at the start of every write: park the first writer, once."""
        if threading.current_thread() is self.first and not self.claimed:
            self.claimed = True
            self.parked.set()
            self.resolved.wait()


class SpyLock:
    """A real lock that says so when it is already held, which is the second writer arriving at a locked store."""

    def __init__(self, overlap: Overlap) -> None:
        self._lock = threading.Lock()
        self._overlap = overlap

    def acquire(self, *, blocking: bool = True, timeout: float = -1) -> bool:
        if self._lock.acquire(blocking=False):
            return True
        self._overlap.resolved.set()
        return self._lock.acquire(blocking=blocking, timeout=timeout)

    def release(self) -> None:
        self._lock.release()

    def __enter__(self) -> bool:
        return self.acquire()

    def __exit__(
        self, kind: type[BaseException] | None, value: BaseException | None, trace: TracebackType | None
    ) -> None:
        self.release()


def seam_path(overlap: Overlap, path: Path) -> Path:
    """Return ``path`` as a ``Path`` whose every derived write target reports to ``overlap`` as a write begins."""

    class SeamPath(Path):
        def with_name(self, name: str) -> Self:
            overlap.arrive()
            return super().with_name(name)

    return SeamPath(path)


def overlapped(overlap: Overlap, first: Callable[[], object], second: Callable[[], object]) -> None:
    """Run ``first`` until it parks, run ``second`` alongside it, and return once both are done."""

    def run_first() -> None:
        try:
            first()
        finally:
            overlap.parked.set()

    def run_second() -> None:
        try:
            second()
        finally:
            overlap.resolved.set()

    writer = threading.Thread(target=run_first)
    overlap.first = writer
    writer.start()
    overlap.parked.wait()
    other = threading.Thread(target=run_second)
    other.start()
    writer.join()
    other.join()


#: Two writes to one store, and a read of every name the two stored.
Case = tuple[Callable[[], object], Callable[[], object], Callable[[], set[str]]]


def live(path: Path, lock: SpyLock) -> Case:
    store = LivePresetStore(path, lock=lock)
    return (
        lambda: store.save("alpha", LiveRecord(chain="chain")),
        lambda: store.save("bravo", LiveRecord(chain="chain")),
        lambda: set(store.all()),
    )


def favorites(path: Path, lock: SpyLock) -> Case:
    store = FavoriteStore(path, lock=lock)
    return (
        lambda: store.write(["alpha"]),
        lambda: store.write_modulators(["bravo"]),
        lambda: {*store.read(), *store.read_modulators()},
    )


def descriptions(path: Path, lock: SpyLock) -> Case:
    store = DescriptionStore(path, now=lambda: datetime(2026, 1, 1, tzinfo=UTC), lock=lock)
    return lambda: store.write("alpha", "text"), lambda: store.write("bravo", "text"), lambda: set(store.read())


def matrixmode(path: Path, lock: SpyLock) -> Case:
    store = MatrixModeStore(path, lock=lock)
    return (
        lambda: store.write("alpha", "speakers"),
        lambda: store.write("bravo", "speakers"),
        lambda: set(store.read()),
    )


def autopilot(path: Path, lock: SpyLock) -> Case:
    store = AutopilotStore(path, lock=lock)
    return (
        lambda: store.set_for_preset("alpha", enabled=True),
        lambda: store.set_for_preset("bravo", enabled=True),
        lambda: {name for name, on in store.read().presets.items() if on},
    )


@pytest.mark.parametrize("driver", [live, favorites, descriptions, matrixmode, autopilot], ids=lambda d: d.__name__)
def test_two_writes_to_one_json_store_both_land(driver: Callable[[Path, SpyLock], Case], tmp_path: Path) -> None:
    overlap = Overlap()
    first, second, stored = driver(seam_path(overlap, tmp_path / "store.json"), SpyLock(overlap))
    overlapped(overlap, first, second)
    assert stored() == {"alpha", "bravo"}
