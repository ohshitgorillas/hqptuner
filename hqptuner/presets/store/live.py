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
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner
# wrote it. A file stamped higher is refused rather than guessed at: applying a
# misread preset writes settings the user never chose. An unstamped file predates
# the stamp and is adopted as the current schema on its next write.
_SCHEMA = 4

#: Record keys no snapshot holds, dropped from a stored record's ``fields`` and ``names`` on read.
_DROPPED = frozenset({"junk_filter"})


#: A live record's settings: each live setting's key to the value its setter sends.
LiveFields = dict[str, str]


class LiveRecordFile(TypedDict):
    """One record as the store persists it and the REST surface answers with it: ``LiveRecord``'s fields."""

    chain: str
    fields: LiveFields
    names: dict[str, str]


class LiveFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the preset map, each entry a ``LiveRecordFile``."""

    schema: int
    presets: dict[str, LiveRecordFile]


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


def _clean(stored: object) -> LiveFile:
    """Return a read document's envelope, keeping each member only when it has the type ``LiveFile`` names.

    A ``presets`` entry that is not an object is dropped here rather than failing every read that reaches it.
    """
    out: LiveFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    presets = stored.get("presets")
    if isinstance(presets, dict):
        out["presets"] = {
            name: _clean_record(record)
            for name, record in presets.items()
            if isinstance(name, str) and isinstance(record, dict)
        }
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


def canonical_name(name: str) -> str:
    """Return the key the store files ``name`` under, raising ``LivePresetError`` when it is not a snapshot name.

    A live snapshot is a JSON key, never a filename, but it shares the config
    store's rule so a name that saves on one surface saves on the other.
    """
    return names.validate_name(name, InvalidSnapshotNameError, "snapshot")


class LivePresetStore:
    """Live snapshots in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never saves one reads as
    empty.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> LiveFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the snapshots silently.
        """

        def _too_new(stamp: int) -> LivePresetSchemaError:
            return LivePresetSchemaError(stamp=stamp, understood=_SCHEMA, what="these presets")

        return _clean(read_stamped(self._path, store="live snapshot", schema=_SCHEMA, too_new=_too_new))

    def _presets(self) -> dict[str, LiveRecordFile]:
        """Return the on-disk record map, each entry checked into ``LiveRecordFile`` but not yet a ``LiveRecord``."""
        return self._read_file().get("presets", {})

    def _write(self, presets: dict[str, LiveRecordFile]) -> None:
        """Rewrite the whole file, stamped.

        Guards the schema first: a store we cannot read is not one we should be writing into.
        """
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "presets": presets}, indent=2))

    def all(self) -> dict[str, LiveRecord]:
        """Every preset, name -> record, sorted by name."""
        presets = self._presets()
        return {name: LiveRecord.from_json(presets[name]) for name in sorted(presets, key=names.sort_key)}

    def read(self, name: str) -> LiveRecord:
        """One preset's record. Raises ``LivePresetError`` if absent."""
        record = self._presets().get(canonical_name(name))
        if record is None:
            raise SnapshotNotFoundError(name=name)
        return LiveRecord.from_json(record)

    def save(self, name: str, record: LiveRecord) -> None:
        """Write (or overwrite) a preset. A name new to the store takes the stricter first-save rule."""
        presets = self._presets()
        key = canonical_name(name)
        if key not in presets:
            names.validate_new_name(key, InvalidSnapshotNameError, MixedScriptSnapshotNameError, "snapshot")
        presets[key] = record.to_json()
        self._write(presets)

    def delete(self, name: str) -> None:
        """Remove a preset. Raises ``LivePresetError`` if absent."""
        presets = self._presets()
        key = canonical_name(name)
        if key not in presets:
            raise SnapshotNotFoundError(name=name)
        del presets[key]
        self._write(presets)
