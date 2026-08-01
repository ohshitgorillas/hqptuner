"""Live presets — named combos of the settings the engine can change right now.

A live preset is not a config snapshot. The tabs view's presets (``presetstore``)
are whole ``hqplayerd.xml`` files applied by restarting the daemon; a live preset
is a handful of enum IDs applied by ``POST /api/config/live``, which never writes
the config file and never restarts anything. The two stores are deliberately
separate: a live preset must stay applicable in one batch, so it holds only what
``lanes/livemap.resolve_live`` accepts back.

The daemon never sees these — they are HQPTuner's own record, stored as one JSON
file (a preset is a few short strings, so a file per preset would be all
overhead). Layout matches ``presetstore``'s conventions: the same name regex, a
schema stamp that refuses a store newer than this HQPTuner understands, and an
unstamped file adopted on its next write.

A record is::

    {"chain": "pcm",
     "fields": {"mode": "pcm", "filter": "40", "dither": "5", "rate": "0", ...},
     "names":  {"mode": "PCM", "filter": "poly-sinc-gauss-long", ...}}

``fields`` is what the live lane takes, output mode included — a preset that could
not say which mode to run could not put the engine back the way it was found. The
mode is why applying one is ``livelane.apply_preset`` rather than a single batch:
``SetMode`` swaps the enumerations the rest resolves against, so it goes first and
alone. ``chain`` records which chain the snapshot was taken on, which is what the
stored filter and shaper IDs index. ``names`` is display only:
the enumerations are engine-built and can shift under a stored preset, so the
card can still say what was saved even when an ID no longer resolves.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .. import __version__

# Same shape as presetstore's: alphanumeric start, then alphanumerics / space /
# underscore / dot / hyphen. A live preset is never a filename, but sharing the
# rule keeps one naming story across both preset surfaces.
_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.\-]*")

# The store's on-disk layout version — what the file MEANS, not which HQPTuner
# wrote it. A file stamped higher is refused rather than guessed at: applying a
# misread preset writes settings the user never chose. An unstamped file predates
# the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1


class LivePresetError(ValueError):
    """A live-preset operation that cannot proceed — an invalid name, or a preset
    that does not exist."""


class LivePresetSchemaError(LivePresetError):
    """The stored file is stamped newer than this HQPTuner understands. Separate
    from ``LivePresetError`` so a route can answer "this store is unreadable"
    rather than "no such preset", which would be a lie about a store that is
    there and full."""


def _validate(name: str) -> str:
    if name != name.strip() or not _NAME_RE.fullmatch(name):
        raise LivePresetError(f"invalid live preset name: {name!r}")
    return name


class LivePresetStore:
    """Live presets in one JSON file. The file (and its directory) is created
    lazily on the first write, so an install that never saves one reads as empty.
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def _read_file(self) -> dict[str, Any]:
        """The file as a dict, empty when absent or unreadable. Every path goes
        through here, so a too-new store refuses uniformly instead of
        half-working."""
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
            raise LivePresetSchemaError(
                f"live preset store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these presets"
            )
        return data

    def _presets(self) -> dict[str, Any]:
        presets = self._read_file().get("presets")
        return presets if isinstance(presets, dict) else {}

    def _write(self, presets: dict[str, Any]) -> None:
        """Rewrite the whole file, stamped. Guards the schema first: a store we
        cannot read is not one we should be writing into."""
        self._read_file()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "presets": presets}, indent=2))

    def names(self) -> list[str]:
        """Every stored preset name, sorted."""
        return sorted(self._presets())

    def all(self) -> dict[str, Any]:
        """Every preset, name -> record, sorted by name."""
        presets = self._presets()
        return {name: presets[name] for name in sorted(presets)}

    def read(self, name: str) -> dict[str, Any]:
        """One preset's record. Raises ``LivePresetError`` if absent."""
        record = self._presets().get(_validate(name))
        if not isinstance(record, dict):
            raise LivePresetError(f"no such live preset: {name!r}")
        return record

    def save(self, name: str, record: dict[str, Any]) -> None:
        """Write (or overwrite) a preset."""
        presets = self._presets()
        presets[_validate(name)] = record
        self._write(presets)

    def delete(self, name: str) -> None:
        """Remove a preset. Raises ``LivePresetError`` if absent."""
        presets = self._presets()
        if _validate(name) not in presets:
            raise LivePresetError(f"no such live preset: {name!r}")
        del presets[name]
        self._write(presets)
