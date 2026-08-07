"""Parking area for uploaded convolution filters (matrix-spec.md "Filter upload").

An upload parks on disk until the next persistent apply injects it into the
restore archive as a ``data/<name>`` member — which the daemon lands in its
home directory (probe-verified on 6.0.4), where the pipeline ``process``
absolute path then resolves. Disk-backed so a backend restart cannot orphan a
staged process string from its file.
"""

from __future__ import annotations

import re
from pathlib import Path

FILTER_EXTS = (".wav", ".txt")


class FilterPark:
    def __init__(self, directory: Path, hqp_home: str) -> None:
        self._dir = directory
        self._home = hqp_home

    def park(self, name: str, data: bytes) -> dict[str, str]:
        """Store one upload.

        Returns the parked name and the daemon-side absolute path a process string should use. Rejects anything but
        .wav/.txt; path components are stripped; a name collision gets a serial suffix.
        """
        safe = re.sub(r"[^\w.\- ]", "_", Path(name).name)
        if not safe or not safe.lower().endswith(FILTER_EXTS):
            raise ValueError("filter upload must be a .wav or .txt file")
        self._dir.mkdir(parents=True, exist_ok=True)
        target = self._dir / safe
        serial = 1
        while target.exists():
            target = self._dir / f"{Path(safe).stem}-{serial}{Path(safe).suffix}"
            serial += 1
        target.write_bytes(data)
        return {"name": target.name, "path": f"{self._home}/{target.name}"}

    def files(self) -> dict[str, bytes]:
        if not self._dir.is_dir():
            return {}
        return {p.name: p.read_bytes() for p in sorted(self._dir.iterdir()) if p.is_file()}

    def members(self) -> dict[str, bytes]:
        """Parked uploads as restore-archive members (``data/<name>``)."""
        return {f"data/{name}": data for name, data in self.files().items()}

    def clear(self) -> None:
        if self._dir.is_dir():
            for p in self._dir.iterdir():
                if p.is_file():
                    p.unlink()
