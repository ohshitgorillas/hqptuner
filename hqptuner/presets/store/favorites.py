"""Favorites — the stars the user put on filter and modulator names, kept for the install rather than for one browser.

A favorite is a NAME, never an enum id: the running engine owns ids and ordering, names are the stable join key
(architecture §3.1), so one list serves all four filter dropdowns (pcm/sdm x 1x/nx) and survives re-enumeration. The
modulator set is a second list on the same terms, serving the one modulator dropdown wherever it is rendered.

Stored as one JSON file beside the live snapshots, and for the same reason: the whole store is a couple of hundred short
strings, so a file per star would be all overhead. Layout follows ``store.live``'s conventions — a schema stamp that
refuses a store newer than this HQPTuner understands, an unstamped file adopted on its next write, lazy creation so an
install that never stars anything reads as empty.

The list is validated rather than trusted. Names come from the engine's own enumeration, so the ceilings here are an
abuse guard and nothing else: HQPlayer offers under a hundred filters per chain, and no name it ships is longer than
32 characters.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal, TypedDict

from hqptuner import __version__
from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.presets.store.unwritable import saving

if TYPE_CHECKING:
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# The two independent sets the file holds, each a list of engine-reported names. They live in one file because they
# are one feature and one user gesture, and each write carries the other kind through untouched, so starring a
# modulator never disturbs a filter star. The stamp covers ``filters`` only, so a reader that knows that kind alone
# reads the filter stars correctly and simply cannot see the modulator ones — better than refusing a store it can
# still understand.
Kind = Literal["filters", "modulators"]
_KINDS: tuple[Kind, ...] = ("filters", "modulators")

# Ceilings on what a client may store. Far past any real list (144 filters exist, none longer than 32 characters),
# close enough to keep a misbehaving client from growing the file without bound.
_MAX_NAMES = 256
_MAX_NAME_LEN = 64


class FavoritesFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the two independent name lists."""

    schema: int
    filters: list[str]
    modulators: list[str]


class FavoriteError(HQPTunerError, ValueError):
    """A favorites operation that cannot proceed — a name list that is not storable."""

    code = "invalid_input"


class FavoriteSchemaError(FavoriteError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``FavoriteError`` so a caller catching the general error catches this too, and separate from it so a
    route can answer "this store is unreadable" rather than "your list is invalid", which would blame the client for
    the server's file.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"favorites store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class TooManyFavoritesError(FavoriteError):
    """A save would carry more favorites than ``_MAX_NAMES``."""

    def __init__(self, *, count: int, limit: int) -> None:
        """Render the wording naming the count that was about to be saved and the limit it exceeds."""
        super().__init__(f"too many favorites: {count} (limit {limit})")


class FavoriteNotStringError(FavoriteError):
    """A staged favorite was not a non-empty string."""

    def __init__(self, *, name: object) -> None:
        """Render the wording naming the rejected value."""
        super().__init__(f"favorite must be a non-empty string: {name!r}")


class FavoriteNameTooLongError(FavoriteError):
    """A staged favorite name exceeded ``_MAX_NAME_LEN`` characters."""

    def __init__(self, *, limit: int, name: str) -> None:
        """Render the wording naming the length limit and the offending name."""
        super().__init__(f"favorite name is longer than {limit} characters: {name!r}")


def _clean(stored: object) -> FavoritesFile:
    """Return a read document's envelope, keeping the stamp when it is an int and the strings of each name list.

    A list member that is not a string is dropped here; empty names and duplicates are ``_read_kind``'s to drop.
    """
    out: FavoritesFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    filters = stored.get("filters")
    if isinstance(filters, list):
        out["filters"] = [name for name in filters if isinstance(name, str)]
    modulators = stored.get("modulators")
    if isinstance(modulators, list):
        out["modulators"] = [name for name in modulators if isinstance(name, str)]
    return out


def _validate(names: list[str]) -> list[str]:
    """Return the names deduplicated and sorted, raising ``FavoriteError`` if the list is not storable."""
    if len(names) > _MAX_NAMES:
        raise TooManyFavoritesError(count=len(names), limit=_MAX_NAMES)
    for name in names:
        if not isinstance(name, str) or not name:
            raise FavoriteNotStringError(name=name)
        if len(name) > _MAX_NAME_LEN:
            raise FavoriteNameTooLongError(limit=_MAX_NAME_LEN, name=name)
    return sorted(set(names))


class FavoriteStore:
    """Favorite filter names in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never stars a filter reads
    as empty.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> FavoritesFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the stars silently.
        """

        def _too_new(stamp: int) -> FavoriteSchemaError:
            return FavoriteSchemaError(stamp=stamp, understood=_SCHEMA, what="these favorites")

        return _clean(read_stamped(self._path, store="favorites", schema=_SCHEMA, too_new=_too_new))

    def _read_kind(self, kind: Kind) -> list[str]:
        """Every starred name under ``kind``, deduplicated and sorted."""
        return sorted({name for name in self._read_file().get(kind, []) if name})

    def _write_kind(self, kind: Kind, names: list[str]) -> list[str]:
        """Replace the set under ``kind`` and return what was stored, carrying the other kind through untouched."""
        stored = _validate(names)
        data = self._read_file()
        keep = {k: data[k] for k in _KINDS if k != kind and k in data}
        with saving("favorites", self._path):
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"schema": _SCHEMA, kind: stored, **keep}, indent=2))
        return stored

    def read(self) -> list[str]:
        """Every starred filter name, deduplicated and sorted. Empty when nothing is stored."""
        return self._read_kind("filters")

    def write(self, names: list[str]) -> list[str]:
        """Replace the whole filter set with ``names`` and return what was stored, leaving the modulators alone.

        Whole-set replace, because the client's state is a set: unstarring is a write without the name. Guards the
        schema first — a store we cannot read is not one we should be writing into.
        """
        return self._write_kind("filters", names)

    def read_modulators(self) -> list[str]:
        """Every starred modulator name, deduplicated and sorted. Empty when nothing is stored."""
        return self._read_kind("modulators")

    def write_modulators(self, names: list[str]) -> list[str]:
        """Replace the whole modulator set with ``names`` and return what was stored, leaving the filters alone."""
        return self._write_kind("modulators", names)
