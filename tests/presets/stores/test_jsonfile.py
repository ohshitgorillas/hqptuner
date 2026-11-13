"""``jsonfile.read_stamped`` — the one reader every stamped JSON store file shares.

A missing file is an empty store nothing has saved into yet; a file that exists but cannot be read as a JSON object
is a broken one, refused rather than quietly read as empty.
"""

from pathlib import Path

import pytest

from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import read_stamped


class _TooNewError(HQPTunerError):
    """A stand-in for a store's own too-new exception."""

    code = "store_too_new"


def _too_new(stamp: int) -> _TooNewError:
    return _TooNewError(f"too new: {stamp}")


@pytest.mark.parametrize(
    ("filename", "expected"),
    [pytest.param("absent.json", {}, id="missing"), pytest.param("present.json", {"x": 2}, id="present")],
)
def test_a_missing_file_reads_as_an_empty_document(tmp_path: Path, filename: str, expected: dict[str, int]) -> None:
    (tmp_path / "present.json").write_text('{"x": 2}')
    assert read_stamped(tmp_path / filename, store="test") == expected


def test_an_existing_file_reads_its_content(tmp_path: Path) -> None:
    path = tmp_path / "ok.json"
    path.write_text('{"schema": 1, "x": 2}')
    present = read_stamped(path, store="test", schema=1, too_new=_too_new)
    assert present == {"schema": 1, "x": 2}


def test_a_schema_newer_than_understood_raises_the_stores_own_too_new_error(tmp_path: Path) -> None:
    path = tmp_path / "new.json"
    path.write_text('{"schema": 99}')
    with pytest.raises(_TooNewError):
        read_stamped(path, store="test", schema=1, too_new=_too_new)
