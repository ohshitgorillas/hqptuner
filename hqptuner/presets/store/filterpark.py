"""Parking area for uploaded convolution filters (matrix-spec.md "Filter upload").

An upload parks on disk until the next persistent apply injects it into the
restore archive as a ``data/<name>`` member — which the daemon lands in its
home directory (probe-verified on 6.0.4), where the pipeline ``process``
absolute path then resolves. Disk-backed so a backend restart cannot orphan a
staged process string from its file.

Nothing is written until the upload passes three checks: the name is a plain
filename the daemon's ``process`` attribute can carry, the bytes are the
container the extension claims, and the park as a whole stays under its
ceiling. The per-file size limit is the route's (it can refuse before reading
the body); the ceiling is here because only the park knows what it holds.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator

FILTER_EXTS = (".wav", ".txt")
# Everything parked between two applies, summed. Bounds what a client under
# the per-file limit can accumulate before an apply or a discard drains it.
PARK_MAX_BYTES = 256 * 1024 * 1024
# `/` and `\` are path separators; `,` `:` `;` are the daemon's process-string
# separators (readme §1.11, "process"); the rest are shell and archive hazards.
_REFUSED_CHARS = frozenset('/\\,:;*?"<>|')
# ASCII control range: below space, plus DEL
_CONTROL_END = 0x20
_DEL = 0x7F


def _check_name(name: str) -> None:
    """Refuse anything but a plain ``.wav``/``.txt`` filename: no path, no daemon separator, no control byte."""
    if not name.lower().endswith(FILTER_EXTS):
        raise ValueError("filter upload must be a .wav or .txt file")
    hostile = any(ch in _REFUSED_CHARS or ord(ch) < _CONTROL_END or ord(ch) == _DEL for ch in name)
    if hostile or name.startswith(".") or ".." in name:
        raise ValueError("filter upload name must be a plain filename")


def _chunks(data: bytes) -> Iterator[tuple[bytes, int]]:
    """Yield ``(tag, payload offset)`` per RIFF chunk after the ``WAVE`` form type, stopping at a truncated header."""
    pos = 12
    while pos + 8 <= len(data):
        size = struct.unpack_from("<I", data, pos + 4)[0]
        yield data[pos : pos + 4], pos + 8
        pos += 8 + size + (size & 1)


def _fmt_is_sane(data: bytes, at: int) -> bool:
    """Report whether the ``fmt `` payload at ``at`` is readable and declares a channel count and rate above zero."""
    if at + 8 > len(data):
        return False
    channels, rate = struct.unpack_from("<HI", data, at + 2)
    return bool(channels > 0 and rate > 0)


def _is_wave(data: bytes) -> bool:
    """Report whether ``data`` is a RIFF form of type WAVE with a sane ``fmt `` chunk and a ``data`` chunk."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return False
    has_fmt = any(tag == b"fmt " and _fmt_is_sane(data, at) for tag, at in _chunks(data))
    return has_fmt and any(tag == b"data" for tag, _ in _chunks(data))


def _is_text(data: bytes) -> bool:
    """Non-empty UTF-8 with no NUL byte: the shape of a Room EQ Wizard filter export, whose layout is not parsed."""
    if not data or b"\0" in data:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _check_body(name: str, data: bytes) -> None:
    """Refuse bytes that are not the container the extension claims."""
    if name.lower().endswith(".wav"):
        if not _is_wave(data):
            raise ValueError("filter upload is not a WAV file")
    elif not _is_text(data):
        raise ValueError("filter upload is not a text file")


class FilterPark:
    """Uploaded convolution filters held under ``directory`` until an apply ships them to the daemon."""

    def __init__(self, directory: Path, hqp_home: str) -> None:
        """Bind the park to ``directory`` on disk and to the daemon home dir the parked paths are reported against."""
        self._dir = directory
        self._home = hqp_home

    def park(self, name: str, data: bytes) -> dict[str, str]:
        """Store one upload.

        Returns the parked name and the daemon-side absolute path a process string should use. Refuses a name that
        is not a plain .wav/.txt filename, a body that is not the container its extension claims, and an upload
        that would push the park over ``PARK_MAX_BYTES``; a name collision gets a serial suffix.
        """
        _check_name(name)
        _check_body(name, data)
        if self._parked_bytes() + len(data) > PARK_MAX_BYTES:
            raise ValueError("parked filters are at their limit; apply or discard pending changes first")
        self._dir.mkdir(parents=True, exist_ok=True)
        target = self._dir / name
        serial = 1
        while target.exists():
            target = self._dir / f"{Path(name).stem}-{serial}{Path(name).suffix}"
            serial += 1
        target.write_bytes(data)
        return {"name": target.name, "path": f"{self._home}/{target.name}"}

    def _parked_bytes(self) -> int:
        """Bytes already parked, by size on disk; zero when the park has never been written."""
        if not self._dir.is_dir():
            return 0
        return sum(p.stat().st_size for p in self._dir.iterdir() if p.is_file())

    def files(self) -> dict[str, bytes]:
        """Return every parked upload's bytes keyed by filename, sorted; empty when nothing is parked."""
        if not self._dir.is_dir():
            return {}
        return {p.name: p.read_bytes() for p in sorted(self._dir.iterdir()) if p.is_file()}

    def members(self) -> dict[str, bytes]:
        """Parked uploads as restore-archive members (``data/<name>``)."""
        return {f"data/{name}": data for name, data in self.files().items()}

    def clear(self) -> None:
        """Delete every parked upload, leaving the directory itself in place."""
        if self._dir.is_dir():
            for p in self._dir.iterdir():
                if p.is_file():
                    p.unlink()
