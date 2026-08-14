"""The two combine-mode facets of the narrow bar, stored server-side.

`genre_mode` and `focus_mode` join the facet set `NarrowingStore` keeps in
`state/narrowing.json`. Each takes `"and"` or `"or"` and nothing else, and each
has its own default: genre combines with AND, focus with OR. Narrowing is
purely presentational and has no daemon field behind it (docs/architecture.md,
"Filter narrowing"), so nothing here reaches hqplayerd and every store file
lands under pytest's ``tmp_path``.

The store's two asymmetries bind these facets like the rest: a **write** refuses
an unknown, wrong-typed or out-of-domain value, because the only client is our
own frontend; a **read** degrades a damaged stored entry to that facet's
default, so a hand-edited file costs the narrowing rather than the bar.

Where the facets sit inside the file the spec does not say, so every case that
reaches into a stored file goes through `edit_facets`, which accepts either a
nested ``facets`` member or the facets beside the schema stamp at the top level.

Only what is particular to a combine mode lives here — its domain, and what a
damaged stored one degrades to. The plain round trip and the defaults table are
`tests/presets/test_narrowing_store.py`'s, which carries both modes in its own
`DEFAULTS` and `SET` tables and covers every facet the same way.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from hqptuner.presets.narrowingstore import NarrowingError, NarrowingStore

#: The two new facets and the default each reads at.
MODE_DEFAULTS: dict[str, str] = {"genre_mode": "and", "focus_mode": "or"}

#: Well-typed tokens outside the domain, and values of the wrong type.
OUT_OF_DOMAIN = ["both", "AND", "any", "", "xor"]
WRONG_TYPE: list[object] = [1, True, None, ["and"], {"mode": "and"}]

#: One in-domain value per facet, each the opposite of that facet's default, so
#: a case that watches a facet return to its default cannot be reading a value
#: that was never moved.
NON_DEFAULT: dict[str, object] = {"genre_mode": "or", "focus_mode": "and"}


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


# --- the domain a write accepts ----------------------------------------------


@pytest.mark.parametrize("facet", sorted(MODE_DEFAULTS))
@pytest.mark.parametrize("value", OUT_OF_DOMAIN)
def test_an_out_of_domain_combine_mode_write_is_refused_naming_the_facet(
    tmp_path: Path, facet: str, value: str
) -> None:
    with pytest.raises(NarrowingError, match=facet):
        store_at(tmp_path).write({facet: value})


@pytest.mark.parametrize("facet", sorted(MODE_DEFAULTS))
@pytest.mark.parametrize("value", WRONG_TYPE)
def test_a_wrong_typed_combine_mode_write_is_refused(tmp_path: Path, facet: str, value: object) -> None:
    with pytest.raises(NarrowingError):
        store_at(tmp_path).write({facet: value})


# --- what a read answers where the file says nothing usable -------------------


@pytest.mark.parametrize("facet", sorted(MODE_DEFAULTS))
def test_a_file_missing_a_combine_mode_reads_that_facet_at_its_default(tmp_path: Path, facet: str) -> None:
    path = stored(tmp_path, NON_DEFAULT)
    edit_facets(path, drop(facet))
    assert store_at(tmp_path).read()[facet] == MODE_DEFAULTS[facet]


@pytest.mark.parametrize("facet", sorted(MODE_DEFAULTS))
@pytest.mark.parametrize("value", OUT_OF_DOMAIN)
def test_an_out_of_domain_stored_combine_mode_reads_as_its_default(tmp_path: Path, facet: str, value: str) -> None:
    path = stored(tmp_path, NON_DEFAULT)
    edit_facets(path, set_to(facet, value))
    assert store_at(tmp_path).read()[facet] == MODE_DEFAULTS[facet]


@pytest.mark.parametrize("facet", sorted(MODE_DEFAULTS))
@pytest.mark.parametrize("value", WRONG_TYPE)
def test_a_wrong_typed_stored_combine_mode_reads_as_its_default(tmp_path: Path, facet: str, value: object) -> None:
    path = stored(tmp_path, NON_DEFAULT)
    edit_facets(path, set_to(facet, value))
    assert store_at(tmp_path).read()[facet] == MODE_DEFAULTS[facet]


# A damaged mode costs its own facet only.
def test_a_damaged_genre_mode_leaves_the_focus_mode_alone(tmp_path: Path) -> None:
    path = stored(tmp_path, NON_DEFAULT)
    edit_facets(path, set_to("genre_mode", "both"))
    assert store_at(tmp_path).read()["focus_mode"] == "and"
