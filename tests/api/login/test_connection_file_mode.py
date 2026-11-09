"""The stored connection is readable by its owner alone (docs/testing.md), whatever the process umask.

The record can hold the password, so its file is created owner-only, also when a temp file from an earlier crash
sits at the name the write uses.
"""

import os
import stat
from collections.abc import Iterator
from pathlib import Path

import pytest

from hqptuner.core.connection import ConnectionRecord, ConnectionStore

RECORD = ConnectionRecord(host="10.0.0.5", username="u", password="p", remember=True)


@pytest.fixture
def umask_022() -> Iterator[None]:
    """The process umask a stock login shell sets, restored afterwards, so the result never depends on the runner's."""
    before = os.umask(0o022)
    yield
    os.umask(before)


def written_mode(path: Path) -> int:
    ConnectionStore(path).write(RECORD)
    return stat.S_IMODE(path.stat().st_mode)


@pytest.mark.usefixtures("umask_022")
def test_a_written_record_is_owner_only(tmp_path: Path) -> None:
    assert written_mode(tmp_path / "connection.json") == 0o600


@pytest.mark.usefixtures("umask_022")
def test_a_leftover_temp_file_with_a_wider_mode_does_not_pass_it_to_the_record(tmp_path: Path) -> None:
    path = tmp_path / "connection.json"
    leftover = tmp_path / "connection.json.tmp"
    leftover.write_text("stale", encoding="utf-8")
    leftover.chmod(0o644)
    assert written_mode(path) == 0o600
