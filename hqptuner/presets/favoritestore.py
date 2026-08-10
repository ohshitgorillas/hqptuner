"""Favorite filters — the stars the user put on filter names, kept for the install rather than for one browser.

A favorite is a filter NAME, never an enum id: the running engine owns ids and ordering, names are the stable join key
(architecture §2), so one list serves all four filter dropdowns (pcm/sdm x 1x/nx) and survives re-enumeration.

Stored as one JSON file beside the live presets, and for the same reason: the whole store is a couple of hundred short
strings, so a file per star would be all overhead. Layout follows ``livepresets``' conventions — a schema stamp that
refuses a store newer than this HQPTuner understands, an unstamped file adopted on its next write, lazy creation so an
install that never stars anything reads as empty.

The list is validated rather than trusted. Names come from the engine's own enumeration, so the ceilings here are an
abuse guard and nothing else: HQPlayer 6.0.4 offers 67 PCM and 77 SDM filters, and the longest name it ships is
32 characters.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from hqptuner import __version__

if TYPE_CHECKING:
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# Ceilings on what a client may store. Far past any real list (144 filters exist, none longer than 32 characters),
# close enough to keep a misbehaving client from growing the file without bound.
_MAX_NAMES = 256
_MAX_NAME_LEN = 64


class FavoriteError(ValueError):
    """A favorites operation that cannot proceed — a name list that is not storable."""


class FavoriteSchemaError(FavoriteError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``FavoriteError`` so a caller catching the general error catches this too, and separate from it so a
    route can answer "this store is unreadable" rather than "your list is invalid", which would blame the client for
    the server's file.
    """


def _validate(names: list[str]) -> list[str]:
    """Return the names deduplicated and sorted, raising ``FavoriteError`` if the list is not storable."""
    if len(names) > _MAX_NAMES:
        raise FavoriteError(f"too many favorites: {len(names)} (limit {_MAX_NAMES})")
    for name in names:
        if not isinstance(name, str) or not name:
            raise FavoriteError(f"favorite must be a non-empty string: {name!r}")
        if len(name) > _MAX_NAME_LEN:
            raise FavoriteError(f"favorite name is longer than {_MAX_NAME_LEN} characters: {name!r}")
    return sorted(set(names))


class FavoriteStore:
    """Favorite filter names in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never stars a filter reads
    as empty.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> dict[str, Any]:
        """Return the file as a dict, empty when absent or unreadable.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working.
        """
        if not self._path.is_file():
            return {}
        try:
            data = json.loads(self._path.read_text())
        except (ValueError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        schema = data.get("schema")
        if isinstance(schema, int) and schema > _SCHEMA:
            raise FavoriteSchemaError(
                f"favorites store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these favorites"
            )
        return data

    def read(self) -> list[str]:
        """Every starred filter name, deduplicated and sorted. Empty when nothing is stored."""
        stored = self._read_file().get("filters")
        if not isinstance(stored, list):
            return []
        return sorted({name for name in stored if isinstance(name, str) and name})

    def write(self, names: list[str]) -> list[str]:
        """Replace the whole set with ``names`` and return what was stored.

        Whole-set replace, because the client's state is a set: unstarring is a write without the name. Guards the
        schema first — a store we cannot read is not one we should be writing into.
        """
        stored = _validate(names)
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "filters": stored}, indent=2))
        return stored
