"""One write for every file a store keeps: the whole new bytes land, or the previous file stays whole.

The bytes go to a uniquely named temp file beside the target, are flushed to disk, and replace the target in one rename;
the directory is then flushed so the rename itself survives a power loss. A write killed at any point before the rename
leaves the target as it was. A temp file a killed process leaves behind carries ``TEMP_SUFFIX``, which ``is_temp``
recognises so a listing can skip it.

Imports nothing from any ``hqptuner`` subpackage, so every layer may use it.
"""

from __future__ import annotations

import contextlib
import os
import secrets
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

#: Ends every temp name. Not ``.xml``, ``.json`` or ``.zip``: no store lists by this suffix.
TEMP_SUFFIX = ".atomictmp"


#: The mode a file is created with when the umask is the only restriction: what ``Path.write_text`` gives.
SHARED_MODE = 0o666


def is_temp(name: str) -> bool:
    """Report whether the filename ``name`` is a temp file this module wrote."""
    return name.endswith(TEMP_SUFFIX)


def write(target: Path, data: bytes, *, mode: int, platform: str = sys.platform) -> None:
    """Replace ``target`` with ``data``, created at ``mode`` (before the umask) when it did not exist.

    ``OSError`` propagates unchanged; the temp file is gone by then and ``target`` is untouched. ``platform`` is the
    ``sys.platform`` value deciding whether the directory flush runs: Windows cannot open a directory.
    """
    # Named by its token alone: a name derived from the target could pass the filesystem's name length limit.
    temp = target.with_name(f".{secrets.token_hex(8)}{TEMP_SUFFIX}")
    # Exclusive create: a leftover or a link planted at the name is refused, never reopened. Binary on every
    # platform: without ``O_BINARY`` a Windows descriptor is text mode and rewrites every line feed.
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        with os.fdopen(os.open(temp, flags, mode), "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        temp.replace(target)
    except BaseException:
        with contextlib.suppress(OSError):
            temp.unlink(missing_ok=True)
        raise
    if platform != "win32":
        _flush_directory(target.parent)


def _flush_directory(directory: Path) -> None:
    """Flush ``directory``'s entries to disk, so a completed rename survives a power loss."""
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
