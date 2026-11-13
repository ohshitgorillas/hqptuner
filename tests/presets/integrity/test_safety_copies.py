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
