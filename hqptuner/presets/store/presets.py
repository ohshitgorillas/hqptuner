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
from typing import TYPE_CHECKING, TypedDict

from hqptuner import __version__
from hqptuner.audit import AuditLog
from hqptuner.config import PRESET_STORE
from hqptuner.errors import HQPTunerError
from hqptuner.presets import names
from hqptuner.presets.store import signed
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.unwritable import reading, saving

if TYPE_CHECKING:
    from pathlib import Path

ACTIVE_FILE = "active.json"
STORE_FILE = "store.json"


class PresetStoreFile(TypedDict, total=False):
    """The on-disk envelope of ``store.json``: the layout stamp beside the one per-store setting it carries."""

    schema: int
    autosave: bool


class ActiveFile(TypedDict, total=False):
    """The on-disk envelope of ``active.json``: the active preset's name, or ``None`` when nothing is loaded."""

    active: str | None


def _clean(stored: object) -> PresetStoreFile:
    """Return a read ``store.json``'s envelope, keeping each member only when it has its ``PresetStoreFile`` type."""
    out: PresetStoreFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    autosave = stored.get("autosave")
    if isinstance(autosave, bool):
        out["autosave"] = autosave
    return out


def _clean_active(stored: object) -> ActiveFile:
    """Return a read ``active.json``'s envelope, keeping ``active`` only when it is a non-empty name or ``None``."""
    out: ActiveFile = {}
    if not isinstance(stored, dict):
        return out
    active = stored.get("active")
    if active is None or (isinstance(active, str) and active):
        out["active"] = active
    return out


# The store's on-disk layout version — what the directory MEANS, not which
# HQPTuner wrote it. Bump only when an older HQPTuner would misread a newer
# store; adding a field nobody older reads is not a bump. A store stamped higher
# than this is refused rather than guessed at, because the failure mode of
# guessing is a silently wrong preset. An unstamped store predates the stamp and
# is adopted as schema 1 on its next write.
_SCHEMA = 1


class PresetError(HQPTunerError, ValueError):
    """A preset operation that cannot proceed.

    Either an invalid name, or a preset that does not exist.
    """

    code = "invalid_input"


class PresetSchemaError(PresetError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``PresetError`` so a caller catching the general error catches this too, and separate from it so a
    route can answer "this store is unreadable" rather than "no such preset", which would be a lie about a store that
    is there and full.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"preset store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class PresetNotFoundError(PresetError):
    """No preset is stored under the given name."""

    code = "not_found"

    def __init__(self, *, name: str) -> None:
        """Render the wording naming the missing preset."""
        super().__init__(f"no such preset: {name!r}")


class InvalidPresetNameError(PresetError):
    """A staged preset name failed the shared naming rule (``names.validate_name``)."""

    code = "name_invalid"

    def __init__(self, *, label: str, reason: str) -> None:
        """Render the wording naming the label and the shared rule's refusal reason."""
        super().__init__(f"Invalid {label} name: {reason}")


class MixedScriptPresetNameError(PresetError):
    """A first-time preset name mixed Latin and Cyrillic letters (``names.validate_new_name``)."""

    code = "name_invalid"

    def __init__(self, *, label: str) -> None:
        """Render the wording naming the label, with the shared rule's fixed mixed-scripts reason."""
        super().__init__(f"Invalid {label} name: {names.MIXED_SCRIPTS}")


def canonical_name(name: str) -> str:
    """Return the name the store keys ``name`` under, raising ``PresetError`` when it is not a preset name.

    Trailing whitespace is trimmed, so a caller that goes on to use the name
    (mirror, pointer, audit, response) uses this value, never its argument.
    """
    return names.validate_name(name, InvalidPresetNameError, "preset")


class PresetStore:
    """Preset snapshots under ``directory``.

    The directory is created lazily on the first write, so an unconfigured install reads as simply empty.
    """

    def __init__(self, directory: Path, audit: AuditLog | None = None) -> None:
        """Bind the store to ``directory`` and to an audit log, substituting a no-op log when none is given."""
        self._dir = directory
        # A store built without one still works; it just records nothing, which
        # is what every offline test that does not care about the log wants.
        self._audit = audit or AuditLog(None)
        # Each served from its last read until the backing file (or, for the
        # listing, the directory) changes signature or this store writes it.
        self._meta = signed.SignedRead(directory / STORE_FILE, self._read_meta)
        self._pointer = signed.SignedRead(directory / ACTIVE_FILE, self._read_pointer)
        self._listing = signed.SignedRead(directory, self._list_names)

    def _path(self, name: str) -> Path:
        return self._dir / f"{canonical_name(name)}.xml"

    def _read_meta(self) -> PresetStoreFile:
        """Return ``store.json``'s envelope, validated by ``_clean``, empty when absent.

        Raises ``PresetError`` when the store is stamped newer than this HQPTuner
        understands, and ``StoreCorruptError`` when the file cannot be read as a
        JSON object at all — every path that touches the store reads it through
        ``_meta``, so both refuse uniformly instead of half-working. ``_meta`` holds
        the envelope while ``store.json`` is unchanged and never holds a read that raised.
        """

        def _too_new(stamp: int) -> PresetSchemaError:
            return PresetSchemaError(stamp=stamp, understood=_SCHEMA, what="these presets")

        path = self._dir / STORE_FILE
        with reading(PRESET_STORE.what, path):
            data = read_stamped(path, store="preset", schema=_SCHEMA, too_new=_too_new)
        return _clean(data)

    def _read_pointer(self) -> ActiveFile:
        """Return ``active.json``'s envelope, raising ``StoreCorruptError`` when it is not a JSON object."""
        path = self._dir / ACTIVE_FILE
        with reading(PRESET_STORE.what, path):
            data = read_stamped(path, store="preset active pointer")
        return _clean_active(data)

    def _list_names(self) -> list[str]:
        """Glob the directory for the stored preset names, sorted."""
        with reading(PRESET_STORE.what, self._dir):
            return sorted((p.stem for p in self._dir.glob("*.xml")), key=names.sort_key)

    def signature(self, name: str) -> signed.Signature:
        """Return preset ``name``'s file signature, ``(st_mtime_ns, st_size)``, or ``None`` when it is not stored.

        A caller holding something derived from a preset's bytes re-derives it only when this moves.
        Raises ``PresetError`` if the name itself is invalid.
        """
        return signed.signature(self._path(name))

    def _ensure_dir(self) -> None:
        """Guard the schema, create the store directory, and stamp it if it carries no stamp yet.

        Guard first: a store we cannot read is not one we should be
        writing into. Stamping on write, not on construction, keeps an unconfigured
        install from materializing a directory it never uses — and adopts a store
        that predates the stamp the moment anything writes to it.
        """
        self._meta.get()
        path = self._dir / STORE_FILE
        with saving(PRESET_STORE.what, self._dir):
            self._dir.mkdir(parents=True, exist_ok=True)
            if not path.is_file():
                path.write_text(json.dumps({"schema": _SCHEMA}))
                self._meta.drop()

    def names(self) -> list[str]:
        """Every stored preset name, sorted.

        Empty when the store has no directory yet. The filesystem stays the authority — ``store.json`` carries the
        layout version and nothing else, and never adds or withholds a name. The directory is globbed again only when
        its signature moved or this store wrote a preset since the last listing.
        """
        if not self._dir.is_dir():
            return []
        self._meta.get()
        return list(self._listing.get())

    def exists(self, name: str) -> bool:
        """Report whether ``name`` is a stored preset. Raises ``PresetError`` if the name itself is invalid."""
        return self._path(name).is_file()

    def read(self, name: str) -> bytes:
        """Return the preset's full config XML. Raises ``PresetError`` if absent."""
        self._meta.get()
        path = self._path(name)
        with reading(PRESET_STORE.what, self._dir):
            if not path.is_file():
                raise PresetNotFoundError(name=name)
            return path.read_bytes()

    def save(self, name: str, xml: bytes, *, trigger: str = "save") -> None:
        """Write (or overwrite) a preset. Creates the store directory if needed.

        ``trigger`` names WHO wrote — an explicit save, auto-save, a profile
        fan-out, the one-time migration. The records are otherwise identical, and
        "which of those wrote over my preset" is the first question an incident
        asks.
        """
        self._ensure_dir()
        name = canonical_name(name)
        path = self._path(name)
        overwrote = path.is_file()  # asked before the write, which erases the answer
        if not overwrote and trigger not in {"migration", "import"}:
            # A first save takes the stricter rule; a migration copies a name the
            # daemon already holds and an import a name a state file already holds,
            # rather than creating one, so both are exempt.
            names.validate_new_name(name, InvalidPresetNameError, MixedScriptPresetNameError, "preset")
        with saving(PRESET_STORE.what, self._dir):
            path.write_bytes(xml)
        self._listing.drop()
        self._audit.preset_write(name, trigger, len(xml), hashlib.sha256(xml).hexdigest(), overwrote=overwrote)

    def delete(self, name: str) -> None:
        """Remove a preset.

        Raises ``PresetError`` if absent; clears the active pointer when the deleted preset was the active one.
        """
        name = canonical_name(name)
        path = self._path(name)
        if not path.is_file():
            raise PresetNotFoundError(name=name)
        was_active = self.active == name  # unlinking does not touch the pointer
        with saving(PRESET_STORE.what, self._dir):
            path.unlink()
        self._listing.drop()
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
        return bool(self._meta.get().get("autosave"))

    def set_autosave(self, *, enabled: bool) -> None:
        """Record the autosave flag in ``store.json`` beside the schema stamp, and audit the change."""
        previous = self._meta.get().get("autosave", False)
        self._ensure_dir()
        with saving(PRESET_STORE.what, self._dir):
            (self._dir / STORE_FILE).write_text(json.dumps({"schema": _SCHEMA, "autosave": bool(enabled)}))
        self._meta.drop()
        self._audit.autosave_set(enabled=bool(enabled), previous=previous)

    @property
    def active(self) -> str | None:
        """The active preset name, or ``None`` when nothing is loaded.

        Raises ``StoreCorruptError`` when the pointer file exists but cannot be read as a JSON object. A held name is
        served while ``active.json`` is unchanged; a read that raised is never held.
        """
        return self._pointer.get().get("active")

    def set_active(self, name: str | None) -> None:
        """Point ``active.json`` at ``name``, or clear it with ``None``, and audit the change.

        The name is validated but not required to exist.
        """
        if name is not None:
            name = canonical_name(name)
        previous = self.active  # the write below is what makes it unreadable
        self._ensure_dir()
        with saving(PRESET_STORE.what, self._dir):
            (self._dir / ACTIVE_FILE).write_text(json.dumps({"active": name}))
        self._pointer.drop()
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
                valid = canonical_name(name)
            except PresetError:
                continue
            if not self.exists(valid):
                self.save(valid, xml, trigger="migration")
                imported.append(valid)
        return sorted(imported)
