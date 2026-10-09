"""The state archive a user attaches to a bug report: HQPTuner's own stores and logs, as one zip.

Every store ``Config`` drives is archived under that store's name, and every file inside a store directory under
``<store name>/<relative path>``. A store missing from disk is skipped. Parked filter uploads under the backup
directory are left out. The saved connection record ships with its password blanked; a record that does not parse as
a JSON object is left out, since a password in a shape this module cannot read is one it cannot blank. The debug log
and its rolled sibling ship under their own basenames, and the in-memory log lines as ``hqptuner.log``.
``stores_archive`` zips a named subset of the stores alone, in the same layout, with no logs.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import TYPE_CHECKING

from hqptuner.config import Config
from hqptuner.presets.store.filterpark import PARK_DIR

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable, Iterator, Sequence
    from pathlib import Path

_LOG_MEMBER = "hqptuner.log"


def _connection_members(path: Path, name: str) -> Iterator[tuple[str, bytes]]:
    """Yield the connection record under ``name`` with ``password`` set to ``""`` and every other field kept.

    Yields nothing when the file does not parse as a JSON object.
    """
    try:
        record = json.loads(path.read_bytes())
    except ValueError:
        return
    if isinstance(record, dict):
        record["password"] = ""
        yield name, json.dumps(record, indent=2).encode()


def _dir_members(root: Path, name: str, park: Path) -> Iterator[tuple[str, bytes]]:
    """Yield every file under ``root``, recursive and sorted, as ``<name>/<relative path>``; nothing under ``park``."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_relative_to(park):
            yield f"{name}/{path.relative_to(root).as_posix()}", path.read_bytes()


def _store_members(cfg: Config, names: Collection[str] | None = None) -> Iterator[tuple[str, bytes]]:
    """Yield every store present on disk as archive members, the connection record blanked or left out.

    ``names`` narrows that to the stores it lists, by archive name; None yields every store.
    """
    park = cfg.backup_dir / PARK_DIR
    for attr, name, is_dir in Config.STORES:
        if names is not None and name not in names:
            continue
        path: Path = getattr(cfg, attr)
        if is_dir:
            yield from _dir_members(path, name, park)
            continue
        if not path.is_file():
            continue
        if path == cfg.connection_file:
            yield from _connection_members(path, name)
        else:
            yield name, path.read_bytes()


def _debug_log_members(debug_log: Path | None) -> Iterator[tuple[str, bytes]]:
    """Yield the debug log and its rolled ``.1`` sibling under their basenames, each only when present."""
    if debug_log is None:
        return
    for path in (debug_log, debug_log.with_name(f"{debug_log.name}.1")):
        if path.is_file():
            yield path.name, path.read_bytes()


def _zip(members: Iterable[tuple[str, bytes]]) -> bytes:
    """Return a deflated zip of ``members``, each a member name and its bytes, in order."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for member, data in members:
            zout.writestr(member, data)
    return out.getvalue()


def stores_archive(cfg: Config, names: Collection[str]) -> bytes:
    """Return a deflated zip of only the stores ``names`` lists, by archive name, laid out as ``state_archive`` does."""
    return _zip(_store_members(cfg, names))


def state_archive(cfg: Config, log_lines: Sequence[str]) -> bytes:
    """Return a deflated zip of the stores ``cfg`` names, the debug log, and ``log_lines`` as ``hqptuner.log``."""
    log = (_LOG_MEMBER, "\n".join(log_lines).encode())
    return _zip((*_store_members(cfg), *_debug_log_members(cfg.debug_log), log))
