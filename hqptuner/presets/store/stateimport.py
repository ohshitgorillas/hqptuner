"""A state archive taken back into this install: the zip ``export.state_archive`` builds, whichever build wrote it.

Reading, checking and writing are separate steps. ``read_upload`` reads an upload, keeping no more of it than the
state limit can admit; ``check`` reads the whole archive and returns the stores it carries, or refuses it;
``save_backup`` and ``replace_stores`` write. Nothing is written until ``check`` has passed every store.

An archive member is one of three things. A single-file store is imported under its own name. The preset store is
``presets/<name>.xml`` for each preset and ``presets/store.json`` for its settings; its active pointer is never
imported, since an import always leaves no preset active, and any other file in it refuses the archive. Every other
member, the connection record, ``backups/`` and the logs included, is not imported. Each JSON store is checked by the
store's own reader over a staged copy, so a store too new or unreadable for this build is refused here exactly as it
would be after landing. The upload, and the bytes its stores unpack to, are each bounded by ``Config.state_max_bytes``.
"""

from __future__ import annotations

import hashlib
import io
import tempfile
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from hqptuner.config import Config
from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.export import stores_archive
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore
from hqptuner.presets.store.presets import (
    ACTIVE_FILE,
    STORE_FILE,
    PresetError,
    PresetStore,
    canonical_name,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from typing import BinaryIO

PRE_IMPORT_BACKUP = "pre-import-state.zip"

_PRESETS = "presets"
_PRESET_SUFFIX = ".xml"
_CHUNK = 1024 * 1024

#: The code every store's own schema error carries for a store stamped newer than this build understands.
_TOO_NEW_CODE = "store_too_new"

#: Each store an import replaces, by its name in the archive, with the store's own reader of a copy at a path. The
#: preset store's reader reads its ``store.json`` and answers the autosave flag it holds.
_READERS: dict[str, Callable[[Path], object]] = {
    "live-presets.json": lambda path: LivePresetStore(path, stations=tuple).book(),
    "favorites.json": lambda path: FavoriteStore(path).read(),
    "narrowing.json": lambda path: NarrowingStore(path).read(),
    "descriptions.json": lambda path: DescriptionStore(path).read(),
    "matrixmodes.json": lambda path: MatrixModeStore(path).read(),
    "autopilot.json": lambda path: AutopilotStore(path).read(),
    _PRESETS: lambda path: PresetStore(path).autosave,
}

#: What reading a damaged or unsupported zip can raise.
_ZIP_ERRORS = (
    zipfile.BadZipFile,
    zipfile.LargeZipFile,
    OSError,
    EOFError,
    RuntimeError,
    NotImplementedError,
    zlib.error,
)


class StateImportError(HQPTunerError):
    """An archive refused before anything was written."""


class StateUnreadableError(StateImportError):
    """An archive that is not a state archive this build can read, or is past the state limit."""

    code = "state_unreadable"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("Not an HQPTuner state file.")


class StateTooNewError(StateImportError):
    """An archive carrying a store stamped newer than this build understands."""

    code = "state_too_new"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("This state file is from a newer HQPTuner. Update HQPTuner first.")


@dataclass(frozen=True)
class Upload:
    """An upload as read: at most one byte past the state limit of it, and the whole upload's size and SHA-256."""

    head: bytes
    size: int
    digest: str


@dataclass(frozen=True)
class CarriedPresets:
    """A checked archive's preset store: each preset's XML by name, and the autosave flag its ``store.json`` holds."""

    xml: dict[str, bytes]
    autosave: bool


@dataclass(frozen=True)
class Carried:
    """The stores a checked archive carries: each single-file store's bytes by name, and its preset store, if any."""

    files: dict[str, bytes]
    presets: CarriedPresets | None

    @property
    def names(self) -> list[str]:
        """Every store carried, by its name in the archive, sorted."""
        return sorted([*self.files, *([_PRESETS] if self.presets is not None else [])])


@dataclass(frozen=True)
class _Members:
    """An archive's store members as read: single-file stores by name, the preset store's by path inside it."""

    files: dict[str, bytes]
    presets: dict[str, bytes] | None


def read_upload(stream: BinaryIO, limit: int) -> Upload:
    """Read ``stream`` to its end, hashing all of it and keeping no more than ``limit + 1`` bytes."""
    digest = hashlib.sha256()
    head = bytearray()
    size = 0
    while chunk := stream.read(_CHUNK):
        digest.update(chunk)
        size += len(chunk)
        head += chunk[: max(0, limit + 1 - len(head))]
    return Upload(bytes(head), size, digest.hexdigest())


def _preset_name(inner: str) -> str:
    """Return the preset a preset store file named ``inner`` holds, under the rule the store reads a held name by.

    Raises ``StateUnreadableError`` for a file that is not a preset this build can hold: one in a subdirectory, one
    that is not ``.xml``, or one whose name the rule refuses or would store under another spelling.
    """
    name = inner.removesuffix(_PRESET_SUFFIX)
    if name == inner:
        raise StateUnreadableError
    try:
        valid = canonical_name(name)
    except PresetError as exc:
        raise StateUnreadableError from exc
    if valid != name:
        raise StateUnreadableError
    return name


def _place(member: str) -> tuple[str, str] | None:
    """Return the store ``member`` belongs to and its path inside that store, ``""`` for a single-file store.

    None for a member no import reads, the preset store's active pointer among them. Raises ``StateUnreadableError``
    for a preset store member that is neither its ``store.json`` nor a preset this build can hold.
    """
    if member in _READERS and member != _PRESETS:
        return member, ""
    head, slash, inner = member.partition("/")
    if head != _PRESETS or not slash or inner == ACTIVE_FILE:
        return None
    if inner != STORE_FILE:
        _preset_name(inner)
    return _PRESETS, inner


def _read_bounded(archive: zipfile.ZipFile, info: zipfile.ZipInfo, budget: int) -> bytes:
    """Return ``info``'s unpacked bytes, raising ``StateUnreadableError`` once they pass ``budget``."""
    with archive.open(info) as member:
        data = member.read(budget + 1)
    if len(data) > budget:
        raise StateUnreadableError
    return data


def _read_members(archive: zipfile.ZipFile, limit: int) -> _Members:
    """Return every store member ``archive`` carries, together unpacking to no more than ``limit`` bytes."""
    files: dict[str, bytes] = {}
    presets: dict[str, bytes] | None = None
    budget = limit
    for info in archive.infolist():
        placed = None if info.is_dir() else _place(info.filename)
        if placed is None:
            continue
        data = _read_bounded(archive, info, budget)
        budget -= len(data)
        store, inner = placed
        if store == _PRESETS:
            presets = {**(presets or {}), inner: data}
        else:
            files[store] = data
    return _Members(files, presets)


def _replace_file(path: Path, data: bytes) -> None:
    """Write ``data`` at ``path`` whole, through a sibling renamed over it, so a reader never sees half a store."""
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(f".{path.name}.import")
    staged.write_bytes(data)
    staged.replace(path)


def _read_staged(name: str, path: Path) -> object:
    """Read the staged store ``name`` at ``path`` with its own reader, refusing the archive when that reader refuses."""
    try:
        return _READERS[name](path)
    except HQPTunerError as exc:
        if exc.code == _TOO_NEW_CODE:
            raise StateTooNewError from exc
        raise StateUnreadableError from exc


def _checked(members: _Members) -> Carried:
    """Read a staged copy of each JSON store ``members`` carries with the store's own reader; return them as carried.

    Refuses the archive on the first store whose reader refuses it.
    """
    with tempfile.TemporaryDirectory() as staging:
        root = Path(staging)
        for name, data in members.files.items():
            _replace_file(root / name, data)
            _read_staged(name, root / name)
        if members.presets is None:
            return Carried(members.files, None)
        meta = members.presets.get(STORE_FILE)
        if meta is not None:
            _replace_file(root / _PRESETS / STORE_FILE, meta)
        autosave = bool(_read_staged(_PRESETS, root / _PRESETS))
    xml = {_preset_name(inner): data for inner, data in members.presets.items() if inner != STORE_FILE}
    return Carried(members.files, CarriedPresets(xml, autosave))


def check(upload: Upload, limit: int) -> Carried:
    """Return the stores ``upload`` carries, each one read and found importable.

    Raises ``StateUnreadableError`` for an upload past ``limit``, one that is not a zip, one whose stores unpack past
    ``limit``, one carrying no store or an unreadable one, and one whose preset store holds a file that is not a preset
    this build can hold; raises ``StateTooNewError`` for one carrying a store stamped newer than this build understands.
    """
    if upload.size > limit:
        raise StateUnreadableError
    try:
        with zipfile.ZipFile(io.BytesIO(upload.head)) as archive:
            members = _read_members(archive, limit)
    except _ZIP_ERRORS as exc:
        raise StateUnreadableError from exc
    if not members.files and members.presets is None:
        raise StateUnreadableError
    return _checked(members)


def save_backup(cfg: Config) -> None:
    """Save every store an import replaces, as it stands, to ``PRE_IMPORT_BACKUP`` under the backup directory.

    Raises ``OSError`` when it cannot be written.
    """
    _replace_file(cfg.backup_dir / PRE_IMPORT_BACKUP, stores_archive(cfg, _READERS.keys()))


def _replace_presets(store: PresetStore, carried: CarriedPresets) -> None:
    """Make ``store`` hold exactly the presets ``carried`` holds, and its autosave flag, through the store itself."""
    for name in store.names():
        if name not in carried.xml:
            store.delete(name)
    for name, xml in carried.xml.items():
        store.save(name, xml, trigger="import")
    store.set_autosave(enabled=carried.autosave)


def replace_stores(cfg: Config, carried: Carried, presets: PresetStore) -> list[str]:
    """Clear the active pointer, then replace each store ``carried`` holds; return their names, sorted.

    ``presets`` is the install's own preset store. Its pointer is cleared first, so a pointer that cannot be read or
    written raises before any store is written.
    """
    presets.set_active(None)
    paths = {name: getattr(cfg, attr) for attr, name, _ in Config.STORES}
    for name, data in carried.files.items():
        _replace_file(paths[name], data)
    if carried.presets is not None:
        _replace_presets(presets, carried.presets)
    return carried.names
