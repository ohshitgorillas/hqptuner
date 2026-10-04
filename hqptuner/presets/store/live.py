"""Live snapshots — named combos of the settings the engine can change right now.

A live snapshot is not a config snapshot. The tabs view's presets (``store.presets``)
are whole ``hqplayerd.xml`` files applied by restarting the daemon; a live snapshot
is a handful of enum IDs applied by ``POST /api/config/live``, which never writes
the config file and never restarts anything. The two stores are deliberately
separate: a live snapshot must stay applicable in one batch, so it holds only what
``lanes/live/routing.resolve_live`` accepts back.

The daemon never sees these — they are HQPTuner's own record, stored as one JSON
file (a preset is a few short strings, so a file per preset would be all
overhead). Layout matches ``store.presets``'s conventions: the same name regex, a
schema stamp that refuses a store newer than this HQPTuner understands, and an
unstamped file adopted on its next write.

Snapshots belong to a station: a config preset, or ``""``, the unnamed default
loaded while no preset is. The file is one book, ``{"schema": 5, "stations":
{station: {name: record}}}``, and the store learns which stations exist from the
callable it is built with, so a save to a station the preset store does not name
is refused. A file in the flat layout older builds wrote (``{"presets": {name:
record}}``) reads with each record under every station the callable names and
under ``""``, so every snapshot a user could recall before is still there; the
next write stores that expansion as the book.

A record is::

    {"chain": "pcm",
     "fields": {"mode": "pcm", "filter": "40", "dither": "5", ...},
     "names":  {"mode": "PCM", "filter": "poly-sinc-gauss-long", ...}}

``fields`` is what the live lane takes, output mode included — a preset that could
not say which mode to run could not put the engine back the way it was found. The
mode is why applying one is ``lane.apply_preset`` rather than a single batch:
``SetMode`` swaps the enumerations the rest resolves against, so it goes first and
alone. ``chain`` records which chain the snapshot was taken on, which is what the
stored filter and shaper IDs index. ``names`` is display only:
the enumerations are engine-built and can shift under a stored preset, so the
card can still say what was saved even when an ID no longer resolves.

The high-frequency (junk) filter follows the material, so no record holds it or
its auto-pilot switch. A record stored under schema 3 or earlier is read without
either: ``junk_filter`` leaves ``fields`` and ``names``, and an ``autopilot`` key
is not read. The next write stamps the file with the current schema.

A record need not carry every setting: a save may name the ones it keeps, and an
apply leaves the absent ones where the engine has them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, TypedDict

from hqptuner import __version__
from hqptuner.errors import HQPTunerError
from hqptuner.presets import names
from hqptuner.presets.store.jsonfile import read_stamped

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner
# wrote it. A file stamped higher is refused rather than guessed at: applying a
# misread preset writes settings the user never chose. An unstamped file predates
# the stamp and is adopted as the current schema on its next write.
_SCHEMA = 5

#: The unnamed default station: the one loaded while no config preset is.
DEFAULT_STATION = ""

#: Record keys no snapshot holds, dropped from a stored record's ``fields`` and ``names`` on read.
_DROPPED = frozenset({"junk_filter"})


#: A live record's settings: each live setting's key to the value its setter sends.
LiveFields = dict[str, str]


class LiveRecordFile(TypedDict):
    """One record as the store persists it and the REST surface answers with it: ``LiveRecord``'s fields."""

    chain: str
    fields: LiveFields
    names: dict[str, str]


#: One station's snapshots as the store persists them: name to record.
LiveShelf = dict[str, LiveRecordFile]


class LiveFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the book, or beside the flat preset map older builds wrote."""

    schema: int
    stations: dict[str, LiveShelf]
    presets: LiveShelf


def _strings(stored: object) -> dict[str, str]:
    """Return a stored map's string entries, less the ``_DROPPED`` keys; an absent or non-map member is empty."""
    if not isinstance(stored, dict):
        return {}
    return {
        key: value
        for key, value in stored.items()
        if isinstance(key, str) and isinstance(value, str) and key not in _DROPPED
    }


def _clean_record(stored: dict[object, object]) -> LiveRecordFile:
    """Return one stored record with each member checked against the type ``LiveRecordFile`` names.

    Any other member, ``autopilot`` among them, is not read.
    """
    return LiveRecordFile(
        chain=str(stored.get("chain", "")),
        fields=_strings(stored.get("fields")),
        names=_strings(stored.get("names")),
    )


def _shelf(stored: object) -> LiveShelf:
    """Return a stored name-to-record map with each record checked; an entry that is not an object is dropped."""
    if not isinstance(stored, dict):
        return {}
    return {
        name: _clean_record(record)
        for name, record in stored.items()
        if isinstance(name, str) and isinstance(record, dict)
    }


def _clean(stored: object) -> LiveFile:
    """Return a read document's envelope, keeping each member only when it has the type ``LiveFile`` names.

    An entry that is not an object is dropped here rather than failing every read that reaches it.
    """
    out: LiveFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    stations = stored.get("stations")
    if isinstance(stations, dict):
        out["stations"] = {
            station: _shelf(shelf)
            for station, shelf in stations.items()
            if isinstance(station, str) and isinstance(shelf, dict)
        }
    presets = stored.get("presets")
    if isinstance(presets, dict):
        out["presets"] = _shelf(presets)
    return out


@dataclass(frozen=True)
class LiveRecord:
    """One live snapshot: the chain it was taken on, the settings it carries, and their display names.

    A record need not carry every setting: a save may name the ones it keeps, and an apply leaves the absent ones
    where the engine has them.
    """

    chain: str
    fields: LiveFields = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: LiveRecordFile) -> LiveRecord:
        """Build from a stored record, already checked member by member (``_clean_record``)."""
        return cls(chain=data["chain"], fields=dict(data["fields"]), names=dict(data["names"]))

    def to_json(self) -> LiveRecordFile:
        """Return the document form this store persists, and the shape the REST surface answers with."""
        return LiveRecordFile(chain=self.chain, fields=dict(self.fields), names=dict(self.names))


class LivePresetError(HQPTunerError, ValueError):
    """A live-snapshot operation that cannot proceed.

    Either an invalid name, or a preset that does not exist.
    """

    code = "invalid_input"


class LivePresetSchemaError(LivePresetError):
    """The stored file is stamped newer than this HQPTuner understands.

    Separate from ``LivePresetError`` so a route can answer "this store is unreadable" rather than "no such preset",
    which would be a lie about a store that is there and full.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"live snapshot store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class SnapshotNotFoundError(LivePresetError):
    """No live snapshot is stored under the given name."""

    code = "not_found"

    def __init__(self, *, name: str) -> None:
        """Render the wording naming the missing snapshot."""
        super().__init__(f"no such live snapshot: {name!r}")


class InvalidSnapshotNameError(LivePresetError):
    """A staged live-snapshot name failed the shared naming rule (``names.validate_name``)."""

    code = "name_invalid"

    def __init__(self, *, label: str, reason: str) -> None:
        """Render the wording naming the label and the shared rule's refusal reason."""
        super().__init__(f"Invalid {label} name: {reason}")


class MixedScriptSnapshotNameError(LivePresetError):
    """A first-time live-snapshot name mixed Latin and Cyrillic letters (``names.validate_new_name``)."""

    code = "name_invalid"

    def __init__(self, *, label: str) -> None:
        """Render the wording naming the label, with the shared rule's fixed mixed-scripts reason."""
        super().__init__(f"Invalid {label} name: {names.MIXED_SCRIPTS}")


class UnknownStationsError(LivePresetError):
    """A save named a station the preset store does not hold."""

    code = "stations_unknown"

    def __init__(self, *, unknown: list[str]) -> None:
        """Render the wording naming each ``unknown`` station, in the order given."""
        super().__init__(f"no such station: {', '.join(repr(station) for station in unknown)}")


def canonical_name(name: str) -> str:
    """Return the key the store files ``name`` under, raising ``LivePresetError`` when it is not a snapshot name.

    A live snapshot is a JSON key, never a filename, but it shares the config
    store's rule so a name that saves on one surface saves on the other.
    """
    return names.validate_name(name, InvalidSnapshotNameError, "snapshot")


class LivePresetStore:
    """Live snapshots in one JSON file, a book of stations each holding its own.

    The file (and its directory) is created lazily on the first write, so an install that never saves one reads as
    empty.
    """

    def __init__(self, path: Path, *, stations: Callable[[], Iterable[str]]) -> None:
        """Bind the store to the JSON file at ``path`` and to ``stations``, the named stations, read on each call.

        The file is not touched until the first write.
        """
        self._path = path
        self._stations = stations

    def _known(self) -> list[str]:
        """Return every station a snapshot may belong to: the default first, then each one ``stations`` names."""
        return [DEFAULT_STATION, *(station for station in self._stations() if station != DEFAULT_STATION)]

    def _read_file(self) -> LiveFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the snapshots silently.
        """

        def _too_new(stamp: int) -> LivePresetSchemaError:
            return LivePresetSchemaError(stamp=stamp, understood=_SCHEMA, what="these presets")

        return _clean(read_stamped(self._path, store="live snapshot", schema=_SCHEMA, too_new=_too_new))

    def _book(self) -> dict[str, LiveShelf]:
        """Return the on-disk book, a flat file's map placed under every known station; records stay unconverted."""
        stored = self._read_file()
        if "stations" in stored:
            return stored["stations"]
        flat = stored.get("presets", {})
        return {station: dict(flat) for station in self._known()} if flat else {}

    def _write(self, book: dict[str, LiveShelf]) -> None:
        """Rewrite the whole file, stamped.

        Guards the schema first: a store we cannot read is not one we should be writing into.
        """
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "stations": book}, indent=2))

    @staticmethod
    def _records(shelf: LiveShelf) -> dict[str, LiveRecord]:
        """Return one station's records, name -> record, sorted by name."""
        return {name: LiveRecord.from_json(shelf[name]) for name in sorted(shelf, key=names.sort_key)}

    def book(self) -> dict[str, dict[str, LiveRecord]]:
        """Every known station's records, the default station first; a station holding none maps to an empty dict."""
        stored = self._book()
        return {station: self._records(stored.get(station, {})) for station in self._known()}

    def all(self, station: str) -> dict[str, LiveRecord]:
        """Every preset ``station`` holds, name -> record, sorted by name."""
        return self._records(self._book().get(station, {}))

    def read(self, station: str, name: str) -> LiveRecord:
        """One preset's record from ``station``. Raises ``LivePresetError`` if absent."""
        record = self._book().get(station, {}).get(canonical_name(name))
        if record is None:
            raise SnapshotNotFoundError(name=name)
        return LiveRecord.from_json(record)

    def save(self, name: str, record: LiveRecord, stations: Iterable[str]) -> None:
        """Write (or overwrite) a preset under each of ``stations``, in one write.

        A name new to any of them takes the stricter first-save rule. A station the store does not know refuses the
        whole save, so a record never lands under some of the stations it was meant for.
        """
        key = canonical_name(name)
        targets = list(dict.fromkeys(stations))
        known = set(self._known())
        unknown = [station for station in targets if station not in known]
        if unknown:
            raise UnknownStationsError(unknown=unknown)
        book = self._book()
        if any(key not in book.get(station, {}) for station in targets):
            names.validate_new_name(key, InvalidSnapshotNameError, MixedScriptSnapshotNameError, "snapshot")
        for station in targets:
            book.setdefault(station, {})[key] = record.to_json()
        self._write(book)

    def delete(self, station: str, name: str) -> None:
        """Remove a preset from ``station``, leaving any other station's copy. Raises ``LivePresetError`` if absent."""
        book = self._book()
        shelf = book.get(station, {})
        key = canonical_name(name)
        if key not in shelf:
            raise SnapshotNotFoundError(name=name)
        del shelf[key]
        self._write(book)

    def forget(self, station: str) -> None:
        """Drop every preset ``station`` holds, as its config preset goes. A station holding none writes nothing."""
        book = self._book()
        if station not in book:
            return
        del book[station]
        self._write(book)
