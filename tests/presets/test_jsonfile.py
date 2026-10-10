"""``jsonfile.read_stamped`` — the one reader every stamped JSON store file shares.

A missing file is an empty store nothing has saved into yet; a file that exists but cannot be read as a JSON object
is a broken one, refused rather than quietly read as empty.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import StoreCorruptError, read_stamped

#: Content that cannot be read as a stamped JSON document: unparseable bytes, and JSON that parses to something
#: other than an object.
CORRUPT = [
    pytest.param("{", id="unterminated"),
    pytest.param("[]", id="json-array"),
    pytest.param('"alpha"', id="json-string"),
    pytest.param("17", id="json-number"),
    pytest.param("null", id="json-null"),
]


class _TooNewError(HQPTunerError):
    """A stand-in for a store's own too-new exception."""

    code = "store_too_new"


def _too_new(stamp: int) -> _TooNewError:
    return _TooNewError(f"too new: {stamp}")


def _corrupt_code(call: Callable[[], object]) -> str:
    """The ``code`` carried by the ``StoreCorruptError`` calling ``call`` raises."""
    with pytest.raises(StoreCorruptError) as caught:
        call()
    return caught.value.code


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


@pytest.mark.parametrize("content", CORRUPT)
def test_a_file_that_is_not_a_stamped_document_is_refused_as_corrupt(tmp_path: Path, content: str) -> None:
    path = tmp_path / "broken.json"
    path.write_text(content)
    assert _corrupt_code(lambda: read_stamped(path, store="test")) == "store_corrupt"


def test_a_schema_newer_than_understood_raises_the_stores_own_too_new_error(tmp_path: Path) -> None:
    path = tmp_path / "new.json"
    path.write_text('{"schema": 99}')
    with pytest.raises(_TooNewError):
        read_stamped(path, store="test", schema=1, too_new=_too_new)
