"""Narrow-bar facets — which filters the four filter dropdowns offer, kept for the install rather than for one browser.

The narrow bar is HQPTuner's own feature: there is no daemon field behind it, so the install is the only place the
facets can live. Stored as one JSON file beside the favorites, and for the same reasons — a dozen-odd short values, so a
file per facet would be all overhead — with ``favorites``'s conventions: a schema stamp that refuses a store newer
than this HQPTuner understands, an unstamped file adopted on its next write, lazy creation so an install that never
narrows anything reads as defaults.

Reading and writing are deliberately asymmetric. A **write** refuses anything it does not recognize, because the
client is HQPTuner's own frontend and a facet it cannot name is a bug worth surfacing. A **read** never raises over a
FACET'S content: an entry that is unknown, wrong-typed or out of domain falls back to that facet's default, so a file
damaged by hand or left behind by an older layout costs the user their narrowing rather than their narrow bar. The
FILE itself is a different matter — one that will not parse as JSON at all is not a damaged narrowing, it is a broken
store, and a read refuses it (``StoreCorruptError``) rather than silently starting the bar over.

The defaults here are the frontend's defaults and must stay in step with them (``static/store/narrow/state.js``). Every
facet starts unnarrowed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypedDict

from hqptuner import __version__
from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.presets.store.narrowingjson import FacetInput, facet_input

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
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


class NarrowingFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the facet map, whose own shape is ``Facets.to_json()``."""

    schema: int
    facets: FacetInput


def _clean(stored: object) -> NarrowingFile:
    """Return a read document's envelope, keeping each member only when it has the type ``NarrowingFile`` names.

    Each facet's own value is judged later, by ``NarrowingStore.read``, against that facet's check.
    """
    out: NarrowingFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    facets = stored.get("facets")
    if isinstance(facets, dict):
        out["facets"] = facet_input(facets)
    return out


class NarrowingError(HQPTunerError, ValueError):
    """A narrowing operation that cannot proceed — a facet object that is not storable."""

    code = "invalid_input"


class NarrowingSchemaError(NarrowingError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``NarrowingError`` so a caller catching the general error catches this too, and separate from it so
    a route can answer "this store is unreadable" rather than "your facets are invalid", which would blame the client
    for the server's file.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"narrowing store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class UnknownFacetError(NarrowingError):
    """A staged payload named a facet key this store does not have."""

    def __init__(self, *, key: str) -> None:
        """Render the wording naming the unknown facet key."""
        super().__init__(f"unknown narrowing facet: {key!r}")


class InvalidFacetValueError(NarrowingError):
    """A staged facet's value did not pass that facet's own check."""

    def __init__(self, *, key: str, value: object) -> None:
        """Render the wording naming the facet and the rejected value."""
        super().__init__(f"narrowing facet {key!r} cannot hold {value!r}")


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


def _quality(value: object) -> bool:
    """Pass the four minimum-quality steps. ``bool`` is excluded: ``True`` is an ``int`` and is not a 1."""
    return isinstance(value, int) and not isinstance(value, bool) and value in _QUALITIES


def _flag(value: object) -> bool:
    """Pass only a real bool — a truthy string is a client bug, not a yes."""
    return isinstance(value, bool)


# Every facet the store holds: its default and the check its value must pass. The frontend's signal names map to these
# keys in the obvious way (nHideLimited <-> hide_limited, nApod1x <-> apod_1x). read() looks up only the keys named
# here; any other key present in a file is ignored and dropped on the next write.
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


def _fresh(value: object) -> object:
    """Return ``value``, copying the list facets so no caller can reach back into a default or a stored object."""
    return list(value) if isinstance(value, list) else value


class FacetsFile(TypedDict):
    """The document form of ``Facets``: one key per facet, as the store persists it and the REST surface answers."""

    genre: list[str]
    genre_mode: str
    quality: int
    focus: list[str]
    focus_mode: str
    phase: list[str]
    length: list[str]
    hide_limited: str
    odd_rate_only: bool
    downsafe_only: bool
    apod_1x: str
    apod_nx: str
    lossy_1x: str
    src_format: str


@dataclass(frozen=True)
class Facets:
    """The narrow bar's whole facet set — every field always present, a stored value or that facet's default."""

    genre: list[str]
    genre_mode: str
    quality: int
    focus: list[str]
    focus_mode: str
    phase: list[str]
    length: list[str]
    hide_limited: str
    odd_rate_only: bool
    downsafe_only: bool
    apod_1x: str
    apod_nx: str
    lossy_1x: str
    src_format: str

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> Facets:
        """Build from a mapping already known to carry every facet's stored value, one key per ``_FACETS`` entry."""
        return cls(**{key: data[key] for key in _FACETS})

    def to_json(self) -> FacetsFile:
        """Return the document form this store persists: one key per facet, ``_FACETS``'s own shape."""
        return FacetsFile(
            genre=list(self.genre),
            genre_mode=self.genre_mode,
            quality=self.quality,
            focus=list(self.focus),
            focus_mode=self.focus_mode,
            phase=list(self.phase),
            length=list(self.length),
            hide_limited=self.hide_limited,
            odd_rate_only=self.odd_rate_only,
            downsafe_only=self.downsafe_only,
            apod_1x=self.apod_1x,
            apod_nx=self.apod_nx,
            lossy_1x=self.lossy_1x,
            src_format=self.src_format,
        )


def _validate(facets: Mapping[str, object]) -> Facets:
    """Return the whole facet set as it will be stored, raising ``NarrowingError`` if any of it is not storable.

    Facets left out are stored at their defaults: the client's state is the whole bar, so a partial write means "the
    rest is unnarrowed", never "leave the rest alone".
    """
    raw: dict[str, object] = dict(facets)
    for key in raw:
        if key not in _FACETS:
            raise UnknownFacetError(key=key)
    stored: dict[str, Any] = {}
    for key, (default, passes) in _FACETS.items():
        if key not in raw:
            stored[key] = _fresh(default)
            continue
        value = raw[key]
        if not passes(value):
            raise InvalidFacetValueError(key=key, value=value)
        stored[key] = _fresh(value)
    return Facets.from_json(stored)


class NarrowingStore:
    """The narrow bar's facets in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never narrows anything
    reads as defaults.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> NarrowingFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the facets silently.
        """

        def _too_new(stamp: int) -> NarrowingSchemaError:
            return NarrowingSchemaError(stamp=stamp, understood=_SCHEMA, what="these facets")

        return _clean(read_stamped(self._path, store="narrowing", schema=_SCHEMA, too_new=_too_new))

    def read(self) -> Facets:
        """Every facet, stored value or default.

        Unknown, wrong-typed and out-of-domain entries fall back to their default rather than raising: a damaged file
        should cost the narrowing, not the narrow bar.
        """
        stored: dict[str, object] = dict(self._read_file().get("facets", {}))
        fields = {
            key: _fresh(stored[key]) if key in stored and passes(stored[key]) else _fresh(default)
            for key, (default, passes) in _FACETS.items()
        }
        return Facets.from_json(fields)

    def write(self, facets: Mapping[str, object]) -> Facets:
        """Replace the whole facet set with ``facets`` and return what was stored.

        Whole-set replace, because the client's state is the whole bar. Guards the schema first — a store we cannot
        read is not one we should be writing into.
        """
        stored = _validate(facets)
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "facets": stored.to_json()}, indent=2))
        return stored
