"""Parking area for uploaded convolution filters (matrix-spec.md "Filter upload").

An upload parks on disk until the next persistent apply injects it into the
restore archive as a ``data/<name>`` member — which the daemon lands in its
home directory, where the pipeline ``process``
absolute path then resolves. Disk-backed so a backend restart cannot orphan a
staged process string from its file.

Nothing is written until the upload passes three checks: the name is a plain
filename the daemon's ``process`` attribute can carry, the bytes are the
container the extension claims, and the park as a whole stays under its
ceiling. The per-file size limit is the route's (it can refuse before reading
the body); the ceiling is here because only the park knows what it holds.
"""

from __future__ import annotations

import contextlib
import struct
import threading
from pathlib import Path
from typing import TYPE_CHECKING

from hqptuner import atomicwrite
from hqptuner.unwritable import deleting, reading, saving

if TYPE_CHECKING:
    from collections.abc import Iterator

#: The park's directory name under the backup directory.
PARK_DIR = "pending-filters"
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
# What a refused read, write or delete says it was handling.
_WHAT = "the uploaded filter"
# Where the daemon lands a parked upload, as a restore-archive member name.
MEMBER_DIR = "data/"


class FilterExtensionRefusedError(ValueError):
    """An uploaded filter's name does not end in one of ``FILTER_EXTS``."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("The filter must be a .wav or .txt file.")


class FilterNameRefusedError(ValueError):
    """An uploaded filter's name carries a path, a daemon separator, or a control byte."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("filter upload name must be a plain filename")


class FilterNotWaveError(ValueError):
    """An upload named ``.wav`` is not a readable RIFF/WAVE container."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("filter upload is not a WAV file")


class FilterNotTextError(ValueError):
    """An upload not named ``.wav`` is not readable UTF-8 text with no NUL byte."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("filter upload is not a text file")


class ParkAtCapacityError(ValueError):
    """An upload would push the park's total bytes over ``PARK_MAX_BYTES``."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("parked filters are at their limit; apply or discard pending changes first")


def _check_name(name: str) -> None:
    """Refuse anything but a plain ``.wav``/``.txt`` filename: no path, no daemon separator, no control byte."""
    if not name.lower().endswith(FILTER_EXTS):
        raise FilterExtensionRefusedError()
    hostile = any(ch in _REFUSED_CHARS or ord(ch) < _CONTROL_END or ord(ch) == _DEL for ch in name)
    if hostile or name.startswith(".") or ".." in name:
        raise FilterNameRefusedError()


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


def _check_body(name: str, data: bytes) -> None:
    """Refuse bytes that are not the container the extension claims.

    The text branch is non-empty UTF-8 with no NUL byte: the shape of a Room EQ Wizard filter export, whose layout is
    not parsed further.
    """
    if name.lower().endswith(".wav"):
        if not _is_wave(data):
            raise FilterNotWaveError()
        return
    if not data or b"\0" in data:
        raise FilterNotTextError()
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FilterNotTextError() from exc


class FilterPark:
    """Uploaded convolution filters held under ``directory`` until an apply ships them to the daemon."""

    def __init__(
        self, directory: Path, hqp_home: str, *, lock: contextlib.AbstractContextManager[object] | None = None
    ) -> None:
        """Bind the park to ``directory`` on disk and to the daemon home dir the parked paths are reported against.

        ``lock`` stands in for the store's own ``threading.Lock``; a test passes one that reports contention.
        """
        self._dir = directory
        self._home = hqp_home
        self._lock = threading.Lock() if lock is None else lock

    def park(self, name: str, data: bytes) -> dict[str, str]:
        """Store one upload.

        Returns the parked name and the daemon-side absolute path a process string should use. Refuses a name that
        is not a plain .wav/.txt filename, a body that is not the container its extension claims, and an upload
        that would push the park over ``PARK_MAX_BYTES``; a name collision gets a serial suffix.
        """
        _check_name(name)
        _check_body(name, data)
        with self._lock:
            if self._parked_bytes() + len(data) > PARK_MAX_BYTES:
                raise ParkAtCapacityError()
            target = self._dir / name
            serial = 1
            with reading(_WHAT, self._dir):
                while target.exists():
                    target = self._dir / f"{Path(name).stem}-{serial}{Path(name).suffix}"
                    serial += 1
            with saving(_WHAT, self._dir):
                self._dir.mkdir(parents=True, exist_ok=True)
                atomicwrite.write(target, data, mode=atomicwrite.SHARED_MODE)
        return {"name": target.name, "path": f"{self._home}/{target.name}"}

    def _parked(self) -> Iterator[Path]:
        """Yield the parked uploads on disk: the files in the directory, a temp file a killed write left excluded."""
        return (p for p in self._dir.iterdir() if p.is_file() and not atomicwrite.is_temp(p.name))

    def _parked_bytes(self) -> int:
        """Bytes already parked, by size on disk; zero when the park has never been written."""
        with reading(_WHAT, self._dir):
            if not self._dir.is_dir():
                return 0
            return sum(p.stat().st_size for p in self._parked())

    def files(self) -> dict[str, bytes]:
        """Return every parked upload's bytes keyed by filename, sorted; empty when nothing is parked."""
        with reading(_WHAT, self._dir):
            if not self._dir.is_dir():
                return {}
            return {p.name: p.read_bytes() for p in sorted(self._parked())}

    def members(self) -> dict[str, bytes]:
        """Parked uploads as restore-archive members (``data/<name>``)."""
        return {f"{MEMBER_DIR}{name}": data for name, data in self.files().items()}

    def release(self, carried: dict[str, bytes]) -> None:
        """Delete the uploads an apply carried (``members`` of an earlier read), each only if its bytes are unchanged.

        A file a discard already removed is skipped, and so is one a later upload re-parked under the same name: it
        holds other bytes and belongs to the next apply.
        """
        with self._lock, deleting(_WHAT, self._dir):
            for member, data in carried.items():
                path = self._dir / member.removeprefix(MEMBER_DIR)
                with contextlib.suppress(FileNotFoundError):
                    if path.read_bytes() == data:
                        path.unlink()

    def clear(self) -> None:
        """Delete every parked upload, leaving the directory itself in place."""
        with self._lock, deleting(_WHAT, self._dir):
            if self._dir.is_dir():
                for p in self._dir.iterdir():
                    if p.is_file():
                        p.unlink()
