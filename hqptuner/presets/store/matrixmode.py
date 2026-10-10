"""Matrix-tab mode per preset — which half of the Matrix tab a preset is listened through.

The Matrix tab shows either the speaker controls or the headphone ones, and which of the two a configuration is FOR is
a property of that configuration: a preset built around crossfeed and a headphone EQ profile is a headphone preset
whatever browser opens it. Kept per install rather than per browser for that reason — the phone and the desktop are
looking at the same preset and must land on the same half.

There is nowhere in hqplayerd's config XML to put it. The daemon re-serializes configuration from its own model, so an
attribute of ours would not survive a reload, and matrix-profile descriptions live in a file of
their own (``descriptions``). So this is one JSON file beside the descriptions and the favorites, keyed by preset
NAME: names are the stable join key (architecture §3.1), and the name is what the preset store itself is keyed by.

Layout follows ``descriptions``' conventions — a schema stamp that refuses a store newer than this HQPTuner
understands, an unstamped file adopted on its next write, lazy creation so an install that never chose reads as empty.
An empty read is what leaves the tab where the user last had it: nothing here migrates existing presets, because a
preset with no recorded mode is one nobody has said anything about, not one that is for speakers.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, TypedDict

from hqptuner import __version__
from hqptuner.config import MATRIX_MODE_STORE
from hqptuner.errors import HQPTunerError
from hqptuner.presets import names
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.unwritable import reading, saving

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


class MatrixModeFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the preset-name-to-mode map."""

    schema: int
    presets: dict[str, str]


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

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"matrix-mode store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class InvalidModeError(MatrixModeError):
    """A staged mode was not one of the two the store accepts."""

    def __init__(self, *, mode: object) -> None:
        """Render the wording naming the accepted modes and the rejected one."""
        super().__init__(f"matrix mode must be one of {' / '.join(_MODES)}: {mode!r}")


class TooManyPresetsError(MatrixModeError):
    """A write would carry more presets with a stored mode than ``_MAX_PRESETS``."""

    def __init__(self, *, count: int, limit: int) -> None:
        """Render the wording naming the count that was about to be saved and the limit it exceeds."""
        super().__init__(f"too many presets with a stored mode: {count} (limit {limit})")


class InvalidPresetNameError(MatrixModeError):
    """A staged preset name failed the shared naming rule (``names.validate_name``).

    ``validate_new_name`` is never called with ``MatrixModeError``, so there is no mixed-script counterpart here.
    """

    code = "name_invalid"

    def __init__(self, *, label: str, reason: str) -> None:
        """Render the wording naming the label and the shared rule's refusal reason."""
        super().__init__(f"Invalid {label} name: {reason}")


def validate_mode(mode: object) -> str:
    """Return the mode as it will be stored, raising ``MatrixModeError`` when it is not one of the two."""
    if not isinstance(mode, str) or mode not in _MODES:
        raise InvalidModeError(mode=mode)
    return mode


def _clean(stored: object) -> MatrixModeFile:
    """Return a read document's envelope, keeping the stamp when it is an int and only the storable preset entries.

    A file another version wrote, or one a client corrupted, loses the entries that make no sense rather than the whole
    store — an unreadable entry costs that preset its recorded mode, which reads as "never chosen".
    """
    out: MatrixModeFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    presets = stored.get("presets")
    if isinstance(presets, dict):
        out["presets"] = {
            name: mode
            for name, mode in presets.items()
            if isinstance(name, str) and name and isinstance(mode, str) and mode in _MODES
        }
    return out


class MatrixModeStore:
    """Per-preset Matrix-tab modes in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never chose a mode reads as
    empty.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> MatrixModeFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the modes silently.
        """

        def _too_new(stamp: int) -> MatrixModeSchemaError:
            return MatrixModeSchemaError(stamp=stamp, understood=_SCHEMA, what="these modes")

        with reading(MATRIX_MODE_STORE.what, self._path):
            data = read_stamped(self._path, store="matrix-mode", schema=_SCHEMA, too_new=_too_new)
        return _clean(data)

    def read(self) -> dict[str, str]:
        """Every stored mode, keyed by preset name. Empty when nothing is stored."""
        return self._read_file().get("presets", {})

    def _save(self, presets: dict[str, str]) -> None:
        """Write ``presets`` out as the whole file, creating the directory on the way."""
        with saving(MATRIX_MODE_STORE.what, self._path):
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"schema": _SCHEMA, "presets": presets}, indent=2, sort_keys=True))

    def forget(self, name: str) -> bool:
        """Drop ``name``'s stored mode, answering whether there was one to drop.

        What a preset delete calls, so it complains about nothing: a name with no entry here, and a name this store
        would refuse to write, are both simply not present. Writes only when something changed, so a delete on an
        install that never chose a mode leaves no file behind.

        Raises ``MatrixModeSchemaError`` when the store is stamped newer than this HQPTuner, and ``StoreCorruptError``
        when it cannot be read at all: both are the caller's decision, not this method's, about whether losing a
        preset must wait on a store beside it that this HQPTuner cannot open.
        """
        presets = self._read_file().get("presets", {})
        if name not in presets:
            return False
        del presets[name]
        self._save(presets)
        return True

    def write(self, name: str, mode: str) -> dict[str, str]:
        """Store ``mode`` against preset ``name`` and return the whole map.

        Answers with the whole map rather than the one entry, because the client renders whichever preset it is looking
        at and a partial answer would leave it guessing about the rest. Guards the schema first — a store we cannot
        read is not one we should be writing into.
        """
        key = names.validate_name(name, InvalidPresetNameError, "preset")
        value = validate_mode(mode)
        presets = self._read_file().get("presets", {})
        presets[key] = value
        if len(presets) > _MAX_PRESETS:
            raise TooManyPresetsError(count=len(presets), limit=_MAX_PRESETS)
        self._save(presets)
        return presets
