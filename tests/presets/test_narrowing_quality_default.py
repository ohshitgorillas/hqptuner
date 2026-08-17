"""The quality facet's server-side default, moved from 0 to 3.

`NarrowingStore` keeps the narrow bar's facet set in `state/narrowing.json`;
narrowing is purely presentational and has no daemon field behind it
(docs/architecture.md, "Filter narrowing"), so nothing here reaches hqplayerd
and every store file lands under pytest's ``tmp_path``.

The facet's domain is unchanged — ``0`` (no quality narrowing), ``3``, ``4``
and ``5`` — but the default a read falls back to is now ``3``. The store's two
asymmetries bind quality like every other facet: a **write** refuses an
out-of-domain, bool or non-integer value, and a **read** degrades a damaged
stored entry to the default rather than raising. An explicitly stored ``0`` is
in-domain and survives a read: the default replaces only what is missing or
damaged, never a value the user chose.

Where the facets sit inside the file the spec does not say, so every case that
reaches into a stored file goes through `edit_facets`, which accepts either a
nested ``facets`` member or the facets beside the schema stamp at the top
level. The plain round trip and the full defaults table are
`tests/presets/test_narrowing_store.py`'s; only what is particular to the
quality default lives here.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from hqptuner.presets.store.narrowing import NarrowingError, NarrowingStore

#: The default quality reads at, and the facet's unchanged domain.
QUALITY_DEFAULT = 3
QUALITY_DOMAIN = [0, 3, 4, 5]

#: Integers outside the domain, bools, and non-integers — all refused on write
#: and degraded to the default on read.
INVALID: list[object] = [1, 2, 6, -1, True, False, "4", 3.5, None]


def store_at(tmp_path: Path) -> NarrowingStore:
    return NarrowingStore(tmp_path / "narrowing.json")


def stored(tmp_path: Path, facets: dict[str, object]) -> Path:
    """A file the store itself wrote, so its layout is the store's own."""
    store_at(tmp_path).write(facets)
    return tmp_path / "narrowing.json"


def edit_facets(path: Path, mutate: Callable[[dict[str, Any]], None]) -> None:
    """Reach into the facet map of a file the store wrote and change it."""
    doc = json.loads(path.read_text())
    inner = doc.get("facets")
    mutate(inner if isinstance(inner, dict) else doc)
    path.write_text(json.dumps(doc))


def set_to(facet: str, value: object) -> Callable[[dict[str, Any]], None]:
    def mutate(facets: dict[str, Any]) -> None:
        facets[facet] = value

    return mutate


def drop(facet: str) -> Callable[[dict[str, Any]], None]:
    def mutate(facets: dict[str, Any]) -> None:
        facets.pop(facet, None)

    return mutate


# --- the default ---------------------------------------------------------------


def test_a_never_written_store_reads_quality_at_3(tmp_path: Path) -> None:
    assert store_at(tmp_path).read()["quality"] == QUALITY_DEFAULT


def test_a_file_with_no_quality_entry_reads_quality_at_3(tmp_path: Path) -> None:
    path = stored(tmp_path, {"phase": ["linear"]})
    edit_facets(path, drop("quality"))
    assert store_at(tmp_path).read()["quality"] == QUALITY_DEFAULT


# --- an explicitly stored value survives, 0 included ------------------------------


def test_a_stored_quality_of_0_survives_a_read(tmp_path: Path) -> None:
    path = stored(tmp_path, {"phase": ["linear"]})
    edit_facets(path, set_to("quality", 0))
    assert store_at(tmp_path).read()["quality"] == 0


@pytest.mark.parametrize("value", QUALITY_DOMAIN)
def test_a_written_in_domain_quality_reads_back_as_written(tmp_path: Path, value: int) -> None:
    store = store_at(tmp_path)
    store.write({"quality": value})
    assert store.read()["quality"] == value


# --- the domain, unchanged ---------------------------------------------------------


@pytest.mark.parametrize("value", INVALID, ids=repr)
def test_an_invalid_quality_write_is_refused(tmp_path: Path, value: object) -> None:
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({"quality": value})


@pytest.mark.parametrize("value", INVALID, ids=repr)
def test_an_invalid_stored_quality_reads_as_the_default_of_3(tmp_path: Path, value: object) -> None:
    path = stored(tmp_path, {"phase": ["linear"]})
    edit_facets(path, set_to("quality", value))
    assert store_at(tmp_path).read()["quality"] == QUALITY_DEFAULT
