"""A file written through ``atomicwrite`` is replaced whole or not at all (docs/testing.md rule 8).

A write killed partway is simulated with a real filesystem refusal: a file size limit on the process, which refuses
the temp file's last bytes after it exists and before it could replace anything.
"""

import resource
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from hqptuner.atomicwrite import TEMP_SUFFIX, is_temp, write

BEFORE = b"the file as it stood"
AFTER = b"the file as it is now written"


@contextmanager
def file_growth_refused(limit: int) -> Iterator[None]:
    """Refuse any write of a file past ``limit`` bytes with ``OSError``, for the block only."""
    soft, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
    resource.setrlimit(resource.RLIMIT_FSIZE, (limit, hard))
    try:
        yield
    finally:
        resource.setrlimit(resource.RLIMIT_FSIZE, (soft, hard))


@pytest.fixture
def target(tmp_path: Path) -> Path:
    path = tmp_path / "store.json"
    path.write_bytes(BEFORE)
    return path


def write_refused_partway(path: Path) -> None:
    with file_growth_refused(len(AFTER) - 1), pytest.raises(OSError):
        write(path, AFTER, mode=0o666)


def test_a_write_killed_partway_leaves_the_previous_bytes(target: Path) -> None:
    write_refused_partway(target)
    assert target.read_bytes() == BEFORE


def test_a_write_killed_partway_leaves_no_temp_file(target: Path) -> None:
    write_refused_partway(target)
    assert [p.name for p in target.parent.iterdir()] == [target.name]


def test_a_refused_rename_leaves_no_temp_file(tmp_path: Path) -> None:
    occupied = tmp_path / "store.json"
    (occupied / "inside").mkdir(parents=True)
    with pytest.raises(OSError):
        write(occupied, AFTER, mode=0o666)
    assert [p.name for p in tmp_path.iterdir()] == [occupied.name]


def test_a_write_replaces_the_previous_bytes(target: Path) -> None:
    write(target, AFTER, mode=0o666)
    assert target.read_bytes() == AFTER


def test_a_write_on_windows_lands_its_bytes(target: Path) -> None:
    write(target, AFTER, mode=0o666, platform="win32")
    assert target.read_bytes() == AFTER


def test_a_write_leaves_no_temp_file(target: Path) -> None:
    write(target, AFTER, mode=0o666)
    assert [p.name for p in target.parent.iterdir()] == [target.name]


def test_bytes_with_line_feeds_land_unchanged(target: Path) -> None:
    write(target, b"a\nb\r\n\x00c", mode=0o666)
    assert target.read_bytes() == b"a\nb\r\n\x00c"


@pytest.mark.parametrize(
    ("name", "expected"), [("store.json", False), ("preset.xml", False), (f".store.json.ab12{TEMP_SUFFIX}", True)]
)
def test_only_a_file_the_write_names_as_temp_is_a_temp_file(name: str, *, expected: bool) -> None:
    assert is_temp(name) is expected
