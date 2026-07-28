"""HQPTuner-owned preset store — full-config XML snapshots in a directory we own.

hqplayerd's named-profile subsystem is ``[default]``-centric and unreliable (POST
``/restore`` drops the daemon to ``[default]`` and ignores a named working member;
``profile/save`` with an existing name silently no-ops; ``/backup`` empties after a
profile load). See ``docs/protocol.md``. HQPTuner therefore keeps each preset as a
full config XML here and drives the daemon through the one reliable primitive —
``POST /restore`` onto ``[default]``. The daemon's own ``data/cfgs/<name>.xml``
files are kept mirrored so its native web UI stays populated, but are never
HQPTuner's load/save path (mirroring/deletion live in the manager's write lane).

This module is pure filesystem: no daemon, no wire. A preset is one ``<name>.xml``
file; the active-preset name is tracked in ``active.json`` beside them, and the
store's own layout version plus per-preset provenance in ``store.json``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from . import __version__

# A preset name is also a filename and a daemon profile name: alphanumeric start,
# then alphanumerics / space / underscore / dot / hyphen (covers "Headphones -
# DSD256"). No path separators, no leading dot — so a name can never escape the
# store directory or shadow ``active.json``.
_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.\-]*")
_ACTIVE_FILE = "active.json"
_STORE_FILE = "store.json"

# The store's on-disk layout version — what the directory MEANS, not which
# HQPTuner wrote it. Bump only when an older HQPTuner would misread a newer
# store; adding a field nobody older reads is not a bump. A store stamped higher
# than this is refused rather than guessed at, because the failure mode of
# guessing is a silently wrong preset. An unstamped store predates the stamp and
# is adopted as schema 1 on its next write.
_SCHEMA = 1


class PresetError(ValueError):
    """A preset operation that cannot proceed — an invalid name, or a preset that
    does not exist."""


def _validate(name: str) -> str:
    if name != name.strip() or ".." in name or not _NAME_RE.fullmatch(name):
        raise PresetError(f"invalid preset name: {name!r}")
    return name


class PresetStore:
    """Preset snapshots under ``directory``. The directory is created lazily on the
    first write, so an unconfigured install reads as simply empty."""

    def __init__(self, directory: Path) -> None:
        self._dir = directory

    def _path(self, name: str) -> Path:
        return self._dir / f"{_validate(name)}.xml"

    def _meta(self) -> dict[str, Any]:
        """``store.json`` as a dict, empty when absent or unreadable. Raises
        ``PresetError`` when the store is stamped newer than this HQPTuner
        understands — every path that touches the store goes through here, so a
        too-new store refuses uniformly instead of half-working."""
        path = self._dir / _STORE_FILE
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text())
        except (ValueError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        schema = data.get("schema")
        if isinstance(schema, int) and schema > _SCHEMA:
            raise PresetError(
                f"preset store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these presets"
            )
        return data

    def _ensure_dir(self) -> None:
        """Guard the schema, create the store directory, and stamp it if it carries
        no stamp yet. Guard first: a store we cannot read is not one we should be
        writing into. Stamping on write, not on construction, keeps an unconfigured
        install from materialising a directory it never uses — and adopts a store
        that predates the stamp the moment anything writes to it."""
        self._meta()
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._dir / _STORE_FILE
        if not path.is_file():
            path.write_text(json.dumps({"schema": _SCHEMA}))

    def names(self) -> list[str]:
        """Every stored preset name, sorted. Empty when the store has no directory
        yet. The filesystem stays the authority — ``store.json`` carries the layout
        version and nothing else, and never adds or withholds a name."""
        if not self._dir.is_dir():
            return []
        self._meta()
        return sorted(p.stem for p in self._dir.glob("*.xml"))

    def exists(self, name: str) -> bool:
        return self._path(name).is_file()

    def read(self, name: str) -> bytes:
        """The preset's full config XML. Raises ``PresetError`` if absent."""
        self._meta()
        path = self._path(name)
        if not path.is_file():
            raise PresetError(f"no such preset: {name!r}")
        return path.read_bytes()

    def save(self, name: str, xml: bytes) -> None:
        """Write (or overwrite) a preset. Creates the store directory if needed."""
        self._ensure_dir()
        self._path(name).write_bytes(xml)

    def delete(self, name: str) -> None:
        """Remove a preset. Raises ``PresetError`` if absent; clears the active
        pointer when the deleted preset was the active one."""
        path = self._path(name)
        if not path.is_file():
            raise PresetError(f"no such preset: {name!r}")
        path.unlink()
        if self.active == name:
            self.set_active(None)

    @property
    def active(self) -> str | None:
        """The active preset name, or ``None`` when nothing is loaded / the pointer
        is unreadable."""
        path = self._dir / _ACTIVE_FILE
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text())
        except (ValueError, OSError):
            return None
        if isinstance(data, dict):
            value = data.get("active")
            return value if isinstance(value, str) else None
        return None

    def set_active(self, name: str | None) -> None:
        if name is not None:
            _validate(name)
        self._ensure_dir()
        (self._dir / _ACTIVE_FILE).write_text(json.dumps({"active": name}))

    def import_missing(self, snapshots: dict[str, bytes]) -> list[str]:
        """One-time migration off hqplayerd's ``data/cfgs/*.xml``: copy in any
        snapshot whose name is not already a preset here. Idempotent — an existing
        preset always wins, and an un-representable daemon name is skipped rather
        than raising. Returns the names imported, sorted."""
        imported: list[str] = []
        for name, xml in snapshots.items():
            try:
                valid = _validate(name)
            except PresetError:
                continue
            if not self.exists(valid):
                self.save(valid, xml)
                imported.append(valid)
        return sorted(imported)
