"""The pre-apply safety copies in ``backup_dir``, driven through the public operations against the fake 8088 daemon.

A copy is the daemon's state before an operation's first restore. Bytes that are not a readable settings archive
never become one (docs/testing.md rule 8: each case below goes red against the single overwritten slot).
"""

from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory

from hqptuner.conf.engineconf import UnreadableArchiveError

#: What the stored copy holds before the operation under test runs.
STORED = b"the copy taken before"

#: Each way a daemon's ``/backup`` can answer with something that is no settings archive, as the fake's state keys.
UNREADABLE_BACKUPS = {
    "empty": {"_pre_backup": b"", "_stale": 1},
    "not-a-zip": {"_corrupt_backup": True},
}


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
