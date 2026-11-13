"""The pre-apply safety copies in ``backup_dir``, driven through the public operations against the fake 8088 daemon.

A copy is the daemon's state before an operation's first restore. Bytes that are not a readable settings archive
never become one (docs/testing.md rule 8: each case below goes red against the single overwritten slot).
"""

import io
import zipfile
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory
from virtual_clock import VirtualClock

from hqptuner.conf import presetconf
from hqptuner.conf.engineconf import UnreadableArchiveError
from hqptuner.core.manager import ConnectionManager

#: What the stored copy holds before the operation under test runs.
STORED = b"the copy taken before"

#: Each way a daemon's ``/backup`` can answer with something that is no settings archive, as the fake's state keys.
UNREADABLE_BACKUPS = {
    "empty": {"_pre_backup": b"", "_stale": 1},
    "not-a-zip": {"_corrupt_backup": True},
}


class SteppingClock(VirtualClock):
    """A ``VirtualClock`` whose wall-clock read moves by ``step``, which the copies' dated names are taken from."""

    def step(self, seconds: float) -> None:
        """Move the instant ``now`` answers with forward by ``seconds``."""
        later = self.now() + timedelta(seconds=seconds)
        object.__setattr__(self, "now", lambda: later)


@pytest.fixture
def clock() -> SteppingClock:
    """The clock every manager in this module paces and dates its copies on."""
    return SteppingClock()


def numbered_archive(number: int) -> bytes:
    """A readable settings archive that carries ``number``, so a copy on disk says which one it is."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("hqplayerd.xml", f"<config copy='{number}'/>")
    return out.getvalue()


def take_copies(manager: ConnectionManager, clock: SteppingClock, numbers: range, *, apart: float) -> None:
    """Take one copy per number, ``apart`` seconds after the one before it."""
    for number in numbers:
        manager.presetops.persist_backup_for_apply(numbered_archive(number))
        clock.step(apart)


def kept_payloads(directory: Path) -> list[bytes]:
    """What each copy in ``directory`` holds, oldest first by name."""
    return [path.read_bytes() for path in sorted(directory.glob("pre-apply-settings*.zip"))]


def stored_copies(directory: Path) -> dict[str, bytes]:
    """Every archive at the top of ``directory`` with its bytes, the park below it left out."""
    return {path.name: path.read_bytes() for path in sorted(directory.glob("*.zip"))}


@pytest.mark.parametrize("unreadable", UNREADABLE_BACKUPS.values(), ids=UNREADABLE_BACKUPS.keys())
async def test_a_backup_that_is_no_archive_replaces_no_stored_copy(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory, tmp_path: Path, unreadable: dict[str, Any]
) -> None:
    manager = await http_manager_factory(http_daemon)
    (tmp_path / "pre-apply-settings.zip").write_bytes(STORED)
    before = stored_copies(tmp_path)
    http_daemon.update(unreadable)
    with pytest.raises(UnreadableArchiveError):
        await manager.applyops.apply_engine({"cuda": "0"})
    assert stored_copies(tmp_path) == before


def test_after_six_copies_the_five_most_recent_remain(
    http_manager: ConnectionManager, clock: SteppingClock, tmp_path: Path
) -> None:
    take_copies(http_manager, clock, range(6), apart=1)
    assert kept_payloads(tmp_path) == [numbered_archive(number) for number in range(1, 6)]


def test_two_copies_taken_at_the_same_instant_both_exist(
    http_manager: ConnectionManager, clock: SteppingClock, tmp_path: Path
) -> None:
    take_copies(http_manager, clock, range(2), apart=0)
    assert kept_payloads(tmp_path) == [numbered_archive(0), numbered_archive(1)]


def test_the_later_of_two_copies_at_one_instant_survives_the_prune(
    http_manager: ConnectionManager, clock: SteppingClock, tmp_path: Path
) -> None:
    take_copies(http_manager, clock, range(5), apart=1)
    take_copies(http_manager, clock, range(5, 7), apart=0)
    assert kept_payloads(tmp_path) == [numbered_archive(number) for number in range(2, 7)]


# --- one operation, one copy: the daemon's state before its first restore ---------------------------------------

#: The title every staged apply below sets.
STAGED_TITLE = "Renamed"


def title_of(copy: Path) -> str | None:
    """The title the working config of the copy at ``copy`` carries."""
    with zipfile.ZipFile(copy) as archive:
        return presetconf.read_config(archive.read("hqplayerd.xml")).get("title")


def newest_copy_in(directory: Path) -> Path | None:
    """The copy that sorts last in ``directory``, or ``None`` when it holds none."""
    return max(directory.glob("pre-apply-settings*.zip"), default=None)


@pytest.fixture
def diverging_manager(http_manager: ConnectionManager, http_daemon: dict[str, Any]) -> ConnectionManager:
    """A manager whose daemon comes back from its first restore of ``STAGED_TITLE`` on another title.

    The apply then takes a second pass, which the daemon adopts as written.
    """
    drifted: list[bool] = []

    def drift() -> None:
        if http_daemon["title"] == STAGED_TITLE and not drifted:
            drifted.append(True)
            http_daemon["title"] = "Drifted"

    http_daemon["_on_restore"] = drift
    return http_manager


@pytest.mark.parametrize("switch_to", [None, "Base", ""], ids=["plain", "loaded-preset", "unloaded"])
async def test_an_apply_that_takes_two_restore_passes_leaves_one_new_copy(
    diverging_manager: ConnectionManager, tmp_path: Path, switch_to: str | None
) -> None:
    await diverging_manager.presetops.save_preset("Base")
    before = stored_copies(tmp_path).keys()
    await diverging_manager.applyops.apply({}, {"title": STAGED_TITLE}, switch_to=switch_to)
    assert len(stored_copies(tmp_path).keys() - before) == 1


async def test_the_copy_an_apply_leaves_holds_the_state_before_its_first_restore(
    diverging_manager: ConnectionManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    held_before = http_daemon["title"]
    await diverging_manager.applyops.apply({}, {"title": STAGED_TITLE})
    newest = newest_copy_in(tmp_path)
    assert newest is not None
    assert title_of(newest) == held_before
