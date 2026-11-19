"""Narrowing in a test: an optional without spending the file's one assertion, and the narrow bar's store.

Plenty of production calls return ``X | None`` — ``StaticMetadata.filter_entry``,
``ControlClient.get_status``'s metadata half, ``ConnectionManager.client``. A test
that goes on to subscript the result has to rule ``None`` out first.

``present`` narrows a value the test only arranges with. A ``None`` arriving here is a
broken fixture, not the behavior under test, so it raises rather than asserts.

The suites of the narrow bar's facets, ``NarrowingStore``'s JSON file, share ``store_at``,
``stored`` and ``edit_facets`` (with the ``set_to`` and ``drop`` mutations) to build a store under
``tmp_path`` and reach into a file it wrote.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from hqptuner.presets.store.narrowing import NarrowingStore


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


def present[T](value: T | None) -> T:
    """``value``, or a failure naming the fixture that came back empty."""
    if value is None:
        raise FixtureError(reason="expected a value, got None")
    return value


def store_at(tmp_path: Path) -> NarrowingStore:
    """The narrowing store over ``narrowing.json`` in ``tmp_path``."""
    return NarrowingStore(tmp_path / "narrowing.json")


def stored(tmp_path: Path, facets: dict[str, object]) -> Path:
    """A file the store itself wrote, so its layout is the store's own."""
    store_at(tmp_path).write(facets)
    return tmp_path / "narrowing.json"


def edit_facets(path: Path, mutate: Callable[[dict[str, Any]], None]) -> None:
    """Reach into the facet map of a file the store wrote and change it.

    Either layout is accepted — the facets nested under ``facets``, or the
    facets beside the stamp at the top level — so these cases pin what a stored
    entry means rather than where it sits.
    """
    doc = json.loads(path.read_text())
    inner = doc.get("facets")
    mutate(inner if isinstance(inner, dict) else doc)
    path.write_text(json.dumps(doc))


def set_to(facet: str, value: object) -> Callable[[dict[str, Any]], None]:
    """A `edit_facets` mutation that stores ``value`` under ``facet``."""

    def mutate(facets: dict[str, Any]) -> None:
        facets[facet] = value

    return mutate


def drop(facet: str) -> Callable[[dict[str, Any]], None]:
    """A `edit_facets` mutation that removes ``facet``."""

    def mutate(facets: dict[str, Any]) -> None:
        facets.pop(facet, None)

    return mutate
