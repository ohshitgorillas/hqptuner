"""Narrow-bar facets — which filters the four filter dropdowns offer, kept for the install rather than for one browser.

The narrow bar is HQPTuner's own feature: there is no daemon field behind it, so the install is the only place the
facets can live. Stored as one JSON file beside the favorites, and for the same reasons — a dozen-odd short values, so a
file per facet would be all overhead — with ``favorites``'s conventions: a schema stamp that refuses a store newer
than this HQPTuner understands, an unstamped file adopted on its next write, lazy creation so an install that never
narrows anything reads as defaults.

Reading and writing are deliberately asymmetric. A **write** refuses anything it does not recognize, because the
client is HQPTuner's own frontend and a facet it cannot name is a bug worth surfacing. A **read** never raises over
content: an entry that is unknown, wrong-typed or out of domain falls back to that facet's default, so a file damaged
by hand or left behind by an older layout costs the user their narrowing rather than their narrow bar.

The defaults here are the frontend's defaults and must stay in step with them (``static/store/narrow/state.js``). Every
facet starts unnarrowed.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from hqptuner import __version__

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# Ceiling on a multi-select facet. Every one of them draws from a closed set of a handful of tokens, so this is an
# abuse guard against a client sending the same token ten thousand times, nothing more.
_MAX_LIST = 32

# The facet token sets, transcribed from the manual's filter tables the same way the frontend's facet-data tables are
# (architecture, "Static facet fallback"). All four are multi-selects, so the empty LIST means "not narrowed at all".
# Phase's "" and length's are real values on top of that — the filters neither taxonomy reaches — as genre's "any" is.
_GENRES = frozenset({"pop", "jazz", "classical", "electronic", "any"})
_FOCUS = frozenset({"transients", "timbre", "space"})
_PHASES = frozenset({"", "linear", "minimum", "intermediate"})
_LENGTHS = frozenset({"", "xshort", "short", "medium", "long", "xlong", "stupid", "adaptive"})
_QUALITIES = frozenset({0, 3, 4, 5})
# The rate-limited hide is tri-state: "auto" follows the DAC (the frontend resolves it against the live rates
# enumeration), "on"/"off" are the user's explicit override.
_RATE_RULES = frozenset({"auto", "on", "off"})
_APOD = frozenset({"only", "half", "all"})
_LOSSY_1X = frozenset({"both", "lossless", "lossy"})
# Source format discloses the chain cards' DSD Sources subsections; it narrows no dropdown. Stored here because it is
# a narrow-bar control and shares the bar's reset.
_SRC_FORMAT = frozenset({"pcm", "both"})
# How each multi-select facet combines its picks. The defaults differ by facet and are the frontend's
# (``static/store/narrow/state.js``): genre ``or``, focus ``and``.
_MODES = frozenset({"and", "or"})


class NarrowingError(ValueError):
    """A narrowing operation that cannot proceed — a facet object that is not storable."""


class NarrowingSchemaError(NarrowingError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``NarrowingError`` so a caller catching the general error catches this too, and separate from it so
    a route can answer "this store is unreadable" rather than "your facets are invalid", which would blame the client
    for the server's file.
    """


def _one_of(allowed: frozenset[Any]) -> Callable[[Any], bool]:
    """Build a check that passes exactly the strings in ``allowed``."""
    return lambda value: isinstance(value, str) and value in allowed


def _list_of(allowed: frozenset[str]) -> Callable[[Any], bool]:
    """Build a check that passes a list of ``allowed`` tokens, up to the length ceiling."""
    return lambda value: (
        isinstance(value, list)
        and len(value) <= _MAX_LIST
        and all(isinstance(item, str) and item in allowed for item in value)
    )


def _quality(value: Any) -> bool:
    """Pass the four minimum-quality steps. ``bool`` is excluded: ``True`` is an ``int`` and is not a 1."""
    return isinstance(value, int) and not isinstance(value, bool) and value in _QUALITIES


def _flag(value: Any) -> bool:
    """Pass only a real bool — a truthy string is a client bug, not a yes."""
    return isinstance(value, bool)


# Every facet the store holds: its default and the check its value must pass. The frontend's signal names map to these
# keys in the obvious way (nHideLimited <-> hide_limited, nApod1x <-> apod_1x). A file written before the rate-change
# facets settled may still carry `ratio` / `upsample_only` / `hide_2x` / `hide_int` / `hires_1x` / `hires_nx`;
# read() only looks up the keys named here, so those entries are ignored and the next write drops them.
_FACETS: dict[str, tuple[Any, Callable[[Any], bool]]] = {
    "genre": ([], _list_of(_GENRES)),
    "genre_mode": ("or", _one_of(_MODES)),
    "quality": (0, _quality),
    "focus": ([], _list_of(_FOCUS)),
    "focus_mode": ("and", _one_of(_MODES)),
    "phase": ([], _list_of(_PHASES)),
    "length": ([], _list_of(_LENGTHS)),
    "hide_limited": ("auto", _one_of(_RATE_RULES)),
    "odd_rate_only": (False, _flag),
    "downsafe_only": (False, _flag),
    "apod_1x": ("all", _one_of(_APOD)),
    "apod_nx": ("all", _one_of(_APOD)),
    "lossy_1x": ("both", _one_of(_LOSSY_1X)),
    "src_format": ("pcm", _one_of(_SRC_FORMAT)),
}


def _fresh(value: Any) -> Any:
    """Return ``value``, copying the list facets so no caller can reach back into a default or a stored object."""
    return list(value) if isinstance(value, list) else value


def _validate(facets: dict[str, Any]) -> dict[str, Any]:
    """Return the whole facet set as it will be stored, raising ``NarrowingError`` if any of it is not storable.

    Facets left out are stored at their defaults: the client's state is the whole bar, so a partial write means "the
    rest is unnarrowed", never "leave the rest alone".
    """
    for key in facets:
        if key not in _FACETS:
            raise NarrowingError(f"unknown narrowing facet: {key!r}")
    stored: dict[str, Any] = {}
    for key, (default, passes) in _FACETS.items():
        if key not in facets:
            stored[key] = _fresh(default)
            continue
        value = facets[key]
        if not passes(value):
            raise NarrowingError(f"narrowing facet {key!r} cannot hold {value!r}")
        stored[key] = _fresh(value)
    return stored


class NarrowingStore:
    """The narrow bar's facets in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never narrows anything
    reads as defaults.
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
            raise NarrowingSchemaError(
                f"narrowing store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these facets"
            )
        return data

    def read(self) -> dict[str, Any]:
        """Every facet, stored value or default.

        Unknown, wrong-typed and out-of-domain entries fall back to their default rather than raising: a damaged file
        should cost the narrowing, not the narrow bar.
        """
        stored = self._read_file().get("facets")
        if not isinstance(stored, dict):
            stored = {}
        return {
            key: _fresh(stored[key]) if key in stored and passes(stored[key]) else _fresh(default)
            for key, (default, passes) in _FACETS.items()
        }

    def write(self, facets: dict[str, Any]) -> dict[str, Any]:
        """Replace the whole facet set with ``facets`` and return what was stored.

        Whole-set replace, because the client's state is the whole bar. Guards the schema first — a store we cannot
        read is not one we should be writing into.
        """
        stored = _validate(facets)
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "facets": stored}, indent=2))
        return stored
