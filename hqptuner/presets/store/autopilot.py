"""Auto-pilot's own state — whether it is on, what it falls back to, and which config presets carry it.

The high-frequency filter auto-pilot is HQPTuner's own feature and hqplayerd knows nothing about it. Neither does its
config file: the daemon's ``/config`` form has no junk-filter field at all, so a config preset's XML snapshot cannot
carry the filter and could not carry a flag about it either. The install is the only place this can live, so it lives
beside the favorites and the narrow bar's facets, with their conventions — a schema stamp that refuses a store newer
than this HQPTuner understands, an unstamped file adopted on its next write, and lazy creation so an install that
never switches auto-pilot on reads as off.

Two things are stored. ``enabled`` is the current state. ``presets`` is the per-config-preset value, keyed by preset
name, so saving a preset records auto-pilot's state and loading it puts that state back. Nothing here records a filter
to fall back to, because auto-pilot has none: its resting state is nothing engaged (``lanes/autopilot.py``).

A damaged file costs auto-pilot rather than the app: anything unreadable or wrong-typed reads as off, on the narrow
bar's reasoning. A too-new stamp is the one thing that raises, because acting on a misread store means writing filter
settings the user never chose.
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


class AutopilotError(ValueError):
    """An auto-pilot store operation that cannot proceed."""


class AutopilotSchemaError(AutopilotError):
    """The stored file is stamped newer than this HQPTuner understands.

    Separate from ``AutopilotError`` so a route can answer "this store is unreadable" rather than describing a state
    it never managed to read.
    """


class AutopilotStore:
    """Auto-pilot's state in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never switches auto-pilot on
    reads as off.
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
            raise AutopilotSchemaError(
                f"auto-pilot store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read this state"
            )
        return data

    def _write(self, data: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({**data, "schema": _SCHEMA}, indent=2))

    @property
    def enabled(self) -> bool:
        """Whether auto-pilot is currently on."""
        return self._read_file().get("enabled") is True

    def enable(self) -> None:
        """Switch auto-pilot on.

        A ``baseline`` left by an older HQPTuner is dropped rather than carried forward: nothing reads it, and a key
        the store no longer means anything by is worse on disk than absent.
        """
        data = self._read_file()
        data.pop("baseline", None)
        self._write({**data, "enabled": True})

    def disable(self) -> None:
        """Switch auto-pilot off."""
        self._write({**self._read_file(), "enabled": False})

    def for_preset(self, name: str) -> bool:
        """Whether the config preset saved under ``name`` carries auto-pilot on."""
        stored = self._read_file().get("presets")
        return isinstance(stored, dict) and stored.get(name) is True

    def set_for_preset(self, name: str, *, enabled: bool) -> None:
        """Record ``enabled`` as the auto-pilot state the config preset ``name`` carries."""
        data = self._read_file()
        presets = data.get("presets")
        stored = dict(presets) if isinstance(presets, dict) else {}
        stored[name] = enabled
        self._write({**data, "presets": stored})
