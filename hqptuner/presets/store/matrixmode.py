"""Matrix-tab mode per preset — which half of the Matrix tab a preset is listened through.

The Matrix tab shows either the speaker controls or the headphone ones, and which of the two a configuration is FOR is
a property of that configuration: a preset built around crossfeed and a headphone EQ profile is a headphone preset
whatever browser opens it. Kept per install rather than per browser for that reason — the phone and the desktop are
looking at the same preset and must land on the same half.

There is nowhere in hqplayerd's config XML to put it. The daemon re-serializes configuration from its own model, so an
attribute of ours would not survive a reload — the same reasoning that put matrix-profile descriptions in a file of
their own (``descriptions``). So this is one JSON file beside the descriptions and the favorites, keyed by preset
NAME: names are the stable join key (architecture §2), and the name is what the preset store itself is keyed by.

Layout follows ``descriptions``' conventions — a schema stamp that refuses a store newer than this HQPTuner
understands, an unstamped file adopted on its next write, lazy creation so an install that never chose reads as empty.
An empty read is what leaves the tab where the user last had it: nothing here migrates existing presets, because a
preset with no recorded mode is one nobody has said anything about, not one that is for speakers.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from hqptuner import __version__
from hqptuner.errors import HQPTunerError
from hqptuner.presets import names

if TYPE_CHECKING:
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# The two halves of the Matrix tab, and the only values storable here. Anything else is a client bug: these strings
# are our own frontend's, not the daemon's, so there is no third value to be liberal about.
_MODES = ("speakers", "headphones")

# A ceiling on entries, matching the preset store's own reach with room to spare. An abuse guard and nothing else.
_MAX_PRESETS = 256


class MatrixModeError(HQPTunerError, ValueError):
    """A matrix-mode operation that cannot proceed — a name or a mode that is not storable."""

    code = "invalid_input"


class MatrixModeSchemaError(MatrixModeError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``MatrixModeError`` so a caller catching the general error catches this too, and separate from it so
    a route can answer "this store is unreadable" rather than "your mode is invalid", which would blame the client for
    the server's file.
    """

    code = "store_too_new"


def _validate_mode(mode: Any) -> str:
    """Return the mode as it will be stored, raising ``MatrixModeError`` when it is not one of the two."""
    if not isinstance(mode, str) or mode not in _MODES:
        raise MatrixModeError(f"matrix mode must be one of {' / '.join(_MODES)}: {mode!r}")
    return mode


def _clean(stored: Any) -> dict[str, str]:
    """Return the storable entries of a ``presets`` mapping, dropping anything that is not one.

    A file another version wrote, or one a client corrupted, loses the entries that make no sense rather than the whole
    store — an unreadable entry costs that preset its recorded mode, which reads as "never chosen".
    """
    if not isinstance(stored, dict):
        return {}
    return {
        name: mode
        for name, mode in stored.items()
        if isinstance(name, str) and name and isinstance(mode, str) and mode in _MODES
    }


class MatrixModeStore:
    """Per-preset Matrix-tab modes in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never chose a mode reads as
    empty.
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
            raise MatrixModeSchemaError(
                f"matrix-mode store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these modes"
            )
        return data

    def read(self) -> dict[str, str]:
        """Every stored mode, keyed by preset name. Empty when nothing is stored."""
        return _clean(self._read_file().get("presets"))

    def write(self, name: str, mode: str) -> dict[str, str]:
        """Store ``mode`` against preset ``name`` and return the whole map.

        Answers with the whole map rather than the one entry, because the client renders whichever preset it is looking
        at and a partial answer would leave it guessing about the rest. Guards the schema first — a store we cannot
        read is not one we should be writing into.
        """
        key = names.validate_name(name, MatrixModeError, "preset")
        value = _validate_mode(mode)
        presets = _clean(self._read_file().get("presets"))
        presets[key] = value
        if len(presets) > _MAX_PRESETS:
            raise MatrixModeError(f"too many presets with a stored mode: {len(presets)} (limit {_MAX_PRESETS})")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "presets": presets}, indent=2, sort_keys=True))
        return presets
