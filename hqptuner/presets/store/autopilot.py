"""Auto-pilot's own state — whether it is on, and which config presets carry it.

The high-frequency filter auto-pilot is HQPTuner's own feature and hqplayerd knows nothing about it. Neither does its
config file: the daemon's ``/config`` form has no junk-filter field at all, so a config preset's XML snapshot cannot
carry the filter and could not carry a flag about it either. The install is the only place this can live, so it lives
beside the favorites and the narrow bar's facets, with their conventions — a schema stamp that refuses a store newer
than this HQPTuner understands, an unstamped file adopted on its next write, and lazy creation so an install that
never switches auto-pilot on reads as off.

Two things are stored. ``enabled`` is the current state. ``presets`` is the per-config-preset value, keyed by preset
name, so saving a preset records auto-pilot's state and loading it puts that state back. Nothing here records a filter
to fall back to, because auto-pilot has none: its resting state is nothing engaged (``lanes/autopilot.py``).

A wrong-typed VALUE inside a readable file costs auto-pilot rather than the app: ``enabled`` that is not a real bool,
or a ``presets`` entry that is not one, reads as off. The FILE itself is a different
matter, like every other store here: one that cannot be read as a JSON object at all raises ``StoreCorruptError``
rather than silently starting auto-pilot over, and a too-new stamp still raises because acting on a misread store
means writing filter settings the user never chose.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, TypedDict

from hqptuner import __version__
from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.presets.store.unwritable import saving

if TYPE_CHECKING:
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1


class AutopilotFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside auto-pilot's own two fields."""

    schema: int
    enabled: bool
    presets: dict[str, bool]


def _clean(stored: object) -> AutopilotFile:
    """Return a read document's envelope, keeping each member only when it has the type ``AutopilotFile`` names.

    ``enabled`` survives only as a real bool, and a ``presets`` value reads as on only when it is ``true``; any other
    member is not kept, so the next write drops it.
    """
    out: AutopilotFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    enabled = stored.get("enabled")
    if isinstance(enabled, bool):
        out["enabled"] = enabled
    presets = stored.get("presets")
    if isinstance(presets, dict):
        out["presets"] = {name: value is True for name, value in presets.items() if isinstance(name, str)}
    return out


class AutopilotError(HQPTunerError, ValueError):
    """An auto-pilot store operation that cannot proceed."""

    code = "invalid_input"


class AutopilotSchemaError(AutopilotError):
    """The stored file is stamped newer than this HQPTuner understands.

    Separate from ``AutopilotError`` so a route can answer "this store is unreadable" rather than describing a state
    it never managed to read.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"auto-pilot store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


@dataclass(frozen=True)
class AutopilotState:
    """Auto-pilot's whole recorded state: whether it is on, and which config presets carry it on."""

    enabled: bool
    presets: dict[str, bool] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: AutopilotFile) -> AutopilotState:
        """Build from the on-disk envelope, missing fields reading as off / empty."""
        return cls(enabled=data.get("enabled", False), presets=dict(data.get("presets", {})))

    def to_json(self) -> AutopilotFile:
        """Return the document form this store persists: the schema stamp beside both fields."""
        return {"schema": _SCHEMA, "enabled": self.enabled, "presets": dict(self.presets)}


class AutopilotStore:
    """Auto-pilot's state in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never switches auto-pilot on
    reads as off.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> AutopilotFile:
        """Return the file as a dict, empty when absent.

        Raises ``AutopilotSchemaError`` when the store is stamped newer than this HQPTuner understands, and
        ``StoreCorruptError`` when the file cannot be read as a JSON object at all.
        """

        def _too_new(stamp: int) -> AutopilotSchemaError:
            return AutopilotSchemaError(stamp=stamp, understood=_SCHEMA, what="this state")

        return _clean(read_stamped(self._path, store="auto-pilot", schema=_SCHEMA, too_new=_too_new))

    def _write(self, state: AutopilotState) -> None:
        with saving("the auto-pilot setting", self._path):
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(state.to_json(), indent=2))

    def read(self) -> AutopilotState:
        """Auto-pilot's whole recorded state."""
        return AutopilotState.from_json(self._read_file())

    @property
    def enabled(self) -> bool:
        """Whether auto-pilot is currently on."""
        return self.read().enabled

    def enable(self) -> None:
        """Switch auto-pilot on."""
        self._write(AutopilotState(enabled=True, presets=self.read().presets))

    def disable(self) -> None:
        """Switch auto-pilot off."""
        self._write(AutopilotState(enabled=False, presets=self.read().presets))

    def for_preset(self, name: str) -> bool:
        """Whether the config preset saved under ``name`` carries auto-pilot on."""
        return self.read().presets.get(name) is True

    def set_for_preset(self, name: str, *, enabled: bool) -> None:
        """Record ``enabled`` as the auto-pilot state the config preset ``name`` carries."""
        state = self.read()
        presets = dict(state.presets)
        presets[name] = enabled
        self._write(AutopilotState(enabled=state.enabled, presets=presets))
