"""A store read or delete the filesystem refuses is reported as ``store_unwritable`` (docs/architecture.md §8.1).

A refused read is not a corrupt store: the bytes were never seen, so nothing can be said about them. Each refusal
names where the store is, so the user knows which path to fix. The path is the fixture's own, so it may be asserted
back; the sentence around it is copy and is not (docs/testing.md rule 9).

Every refusal here is a permission bit the fixture cleared. A process the bit does not bind refuses the fixture rather
than passing a case that tested nothing.
"""

import os
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from narrow import FixtureError

from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.presets import PresetStore

#: The code a store access the filesystem refused carries.
STORE_UNWRITABLE = "store_unwritable"

#: What ``_refusal`` reports for the code of an exception that carries none, or of a call that raised nothing.
NO_CODE = ""

#: What ``_refusal`` reports for the text when ``call`` raised no ``store_unwritable`` report to read it from.
NO_REPORT = ""

#: A preset payload the store keeps as opaque bytes.
PAYLOAD = b"<hqplayerd/>"

#: The preset whose file the delete cases block.
NAME = "alpha"

#: The named stations the live-snapshot store is bound to: none, so only the default station exists.
NO_STATIONS: Callable[[], list[str]] = list

#: The unnamed default station, whose snapshots the refused read lists.
DEFAULT_STATION = ""


def _refusal(call: Callable[[], object]) -> tuple[str, str]:
    """The ``code`` of whatever ``call`` raises, and the text of the ``store_unwritable`` report it raised.

    The code is ``NO_CODE`` when the exception carries none or nothing was raised. The text is ``NO_REPORT`` unless the
    exception is a ``store_unwritable`` report, since another report naming the path is not the report under test.
    """
    try:
        call()
    except (HQPTunerError, OSError) as exc:
        code = str(getattr(exc, "code", NO_CODE))
        return code, str(exc) if code == STORE_UNWRITABLE else NO_REPORT
    return NO_CODE, NO_REPORT


@pytest.fixture
def refused_read(tmp_path: Path) -> Iterator[tuple[Path, tuple[str, str]]]:
    """A live-snapshot store's default station listed from a file nobody may read, and what the listing raised."""
    path = tmp_path / "live-presets.json"
    path.write_text("{}")
    store = LivePresetStore(path, stations=NO_STATIONS)
    path.chmod(0)
    try:
        if os.access(path, os.R_OK):
            raise FixtureError(reason="this process reads a file whose read bits are clear")
        yield path, _refusal(lambda: store.all(DEFAULT_STATION))
    finally:
        path.chmod(0o600)


@pytest.fixture
def refused_delete(tmp_path: Path) -> Iterator[tuple[Path, tuple[str, str]]]:
    """A preset delete in a directory nobody may write, and what the delete raised."""
    root = tmp_path / "presets"
    store = PresetStore(root)
    store.save(NAME, PAYLOAD)
    saved = [path for path in root.rglob("*") if path.is_file() and path.read_bytes() == PAYLOAD]
    if len(saved) != 1:
        raise FixtureError(reason=f"expected one file holding the saved preset, found {len(saved)}")
    holder = saved[0].parent
    holder.chmod(0o500)
    try:
        if os.access(holder, os.W_OK):
            raise FixtureError(reason="this process writes a directory whose write bits are clear")
        yield root, _refusal(lambda: store.delete(NAME))
    finally:
        holder.chmod(0o700)


def test_a_store_read_the_filesystem_refuses_carries_code_store_unwritable(
    refused_read: tuple[Path, tuple[str, str]],
) -> None:
    _, (code, _) = refused_read
    assert code == STORE_UNWRITABLE


def test_the_unwritable_report_of_a_refused_store_read_names_the_store_file(
    refused_read: tuple[Path, tuple[str, str]],
) -> None:
    path, (_, text) = refused_read
    assert str(path) in text


def test_a_preset_delete_the_filesystem_refuses_carries_code_store_unwritable(
    refused_delete: tuple[Path, tuple[str, str]],
) -> None:
    _, (code, _) = refused_delete
    assert code == STORE_UNWRITABLE


def test_the_unwritable_report_of_a_refused_preset_delete_names_the_store_directory(
    refused_delete: tuple[Path, tuple[str, str]],
) -> None:
    root, (_, text) = refused_delete
    assert str(root) in text
