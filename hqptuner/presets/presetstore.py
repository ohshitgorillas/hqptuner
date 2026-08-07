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

import hashlib
import json
from pathlib import Path
from typing import Any

from hqptuner import __version__
from hqptuner.audit import AuditLog
from hqptuner.presets import names

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
    """A preset operation that cannot proceed.

    Either an invalid name, or a preset that does not exist.
    """


def _validate(name: str) -> str:
    return names.validate_name(name, PresetError, "preset")


class PresetStore:
    """Preset snapshots under ``directory``.

    The directory is created lazily on the first write, so an unconfigured install reads as simply empty.
    """

    def __init__(self, directory: Path, audit: AuditLog | None = None) -> None:
        self._dir = directory
        # A store built without one still works; it just records nothing, which
        # is what every offline test that does not care about the log wants.
        self._audit = audit or AuditLog(None)

    def _path(self, name: str) -> Path:
        return self._dir / f"{_validate(name)}.xml"

    def _meta(self) -> dict[str, Any]:
        """``store.json`` as a dict, empty when absent or unreadable.

        Raises ``PresetError`` when the store is stamped newer than this HQPTuner
        understands — every path that touches the store goes through here, so a
        too-new store refuses uniformly instead of half-working.
        """
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
        """Guard the schema, create the store directory, and stamp it if it carries no stamp yet.

        Guard first: a store we cannot read is not one we should be
        writing into. Stamping on write, not on construction, keeps an unconfigured
        install from materialising a directory it never uses — and adopts a store
        that predates the stamp the moment anything writes to it.
        """
        self._meta()
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._dir / _STORE_FILE
        if not path.is_file():
            path.write_text(json.dumps({"schema": _SCHEMA}))

    def names(self) -> list[str]:
        """Every stored preset name, sorted.

        Empty when the store has no directory yet. The filesystem stays the authority — ``store.json`` carries the
        layout version and nothing else, and never adds or withholds a name.
        """
        if not self._dir.is_dir():
            return []
        self._meta()
        return sorted(p.stem for p in self._dir.glob("*.xml"))

    def exists(self, name: str) -> bool:
        return self._path(name).is_file()

    def read(self, name: str) -> bytes:
        """Return the preset's full config XML. Raises ``PresetError`` if absent."""
        self._meta()
        path = self._path(name)
        if not path.is_file():
            raise PresetError(f"no such preset: {name!r}")
        return path.read_bytes()

    def save(self, name: str, xml: bytes, *, trigger: str = "save") -> None:
        """Write (or overwrite) a preset. Creates the store directory if needed.

        ``trigger`` names WHO wrote — an explicit save, auto-save, a profile
        fan-out, the one-time migration. The records are otherwise identical, and
        "which of those wrote over my preset" is the first question an incident
        asks.
        """
        self._ensure_dir()
        path = self._path(name)
        overwrote = path.is_file()  # asked before the write, which erases the answer
        path.write_bytes(xml)
        self._audit.preset_write(name, trigger, len(xml), hashlib.sha256(xml).hexdigest(), overwrote=overwrote)

    def delete(self, name: str) -> None:
        """Remove a preset.

        Raises ``PresetError`` if absent; clears the active pointer when the deleted preset was the active one.
        """
        path = self._path(name)
        if not path.is_file():
            raise PresetError(f"no such preset: {name!r}")
        was_active = self.active == name  # unlinking does not touch the pointer
        path.unlink()
        self._audit.preset_delete(name, was_active=was_active)
        if was_active:
            self.set_active(None)

    @property
    def autosave(self) -> bool:
        """Whether every successful apply/live write is folded back into the active preset.

        Lives in ``store.json`` — a per-store fact, not a
        per-browser one. Adding this field is not a schema bump: an older
        HQPTuner ignoring it merely doesn't auto-save.
        """
        return bool(self._meta().get("autosave"))

    def set_autosave(self, *, enabled: bool) -> None:
        meta = self._meta()
        previous = bool(meta.get("autosave"))
        self._ensure_dir()
        meta["schema"] = meta.get("schema", _SCHEMA)
        meta["autosave"] = bool(enabled)
        (self._dir / _STORE_FILE).write_text(json.dumps(meta))
        self._audit.autosave_set(enabled=bool(enabled), previous=previous)

    @property
    def active(self) -> str | None:
        """The active preset name, or ``None`` when nothing is loaded.

        Also ``None`` when the pointer is unreadable.
        """
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
        previous = self.active  # the write below is what makes it unreadable
        self._ensure_dir()
        (self._dir / _ACTIVE_FILE).write_text(json.dumps({"active": name}))
        self._audit.active_set(name, previous)

    def import_missing(self, snapshots: dict[str, bytes]) -> list[str]:
        """One-time migration off hqplayerd's ``data/cfgs/*.xml``.

        Copies in any snapshot whose name is not already a preset here. Idempotent — an existing
        preset always wins, and an un-representable daemon name is skipped rather
        than raising. Returns the names imported, sorted.
        """
        imported: list[str] = []
        for name, xml in snapshots.items():
            try:
                valid = _validate(name)
            except PresetError:
                continue
            if not self.exists(valid):
                self.save(valid, xml, trigger="migration")
                imported.append(valid)
        return sorted(imported)
