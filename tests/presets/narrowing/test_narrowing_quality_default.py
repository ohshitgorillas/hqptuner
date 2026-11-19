"""The quality facet's server-side default of 0, "Any quality".

`NarrowingStore` keeps the narrow bar's facet set in `state/narrowing.json`;
narrowing is purely presentational and has no daemon field behind it,
so nothing here reaches hqplayerd
and every store file lands under pytest's ``tmp_path``.

The facet's domain is unchanged — ``0`` (no quality narrowing), ``3``, ``4``
and ``5`` — and the default a read falls back to is ``0`` (quality-default-any
spec delta): a never-written store and a file with no or a damaged quality
entry all read ``0``. The store's two asymmetries bind quality like every
other facet: a **write** refuses an out-of-domain, bool or non-integer value,
and a **read** degrades a damaged stored entry to the default rather than
raising. An explicitly stored in-domain value survives a read: the default
replaces only what is missing or damaged, never a value the user chose.

Where the facets sit inside the file the spec does not say, so every case that
reaches into a stored file goes through `edit_facets`, which accepts either a
nested ``facets`` member or the facets beside the schema stamp at the top
level. The plain round trip and the full defaults table are
`tests/presets/narrowing/test_narrowing_store.py`'s; only what is particular to the
quality default lives here.
"""

from pathlib import Path

import pytest
from narrow import drop, edit_facets, set_to, store_at, stored

from hqptuner.presets.store.narrowing import NarrowingError

#: The default quality reads at, and the facet's unchanged domain.
QUALITY_DEFAULT = 0

#: Integers outside the domain, bools, and non-integers — all refused on write
#: and degraded to the default on read.
INVALID: list[object] = [1, 2, 6, -1, True, False, "4", 3.5, None]


# --- the default ---------------------------------------------------------------


def test_a_file_with_no_quality_entry_reads_quality_at_0(tmp_path: Path) -> None:
    path = stored(tmp_path, {"phase": ["linear"]})
    edit_facets(path, drop("quality"))
    assert store_at(tmp_path).read().quality == QUALITY_DEFAULT


# --- the domain, unchanged ---------------------------------------------------------


@pytest.mark.parametrize("value", INVALID, ids=repr)
def test_an_invalid_quality_write_is_refused(tmp_path: Path, value: object) -> None:
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({"quality": value})


@pytest.mark.parametrize("value", [v for v in INVALID if v is not False], ids=repr)
def test_an_invalid_stored_quality_reads_as_the_default_of_0(tmp_path: Path, value: object) -> None:
    path = stored(tmp_path, {"phase": ["linear"]})
    edit_facets(path, set_to("quality", value))
    assert store_at(tmp_path).read().quality == QUALITY_DEFAULT
