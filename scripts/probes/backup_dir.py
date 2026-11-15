"""Where the probes keep the pristine archive, and whether that directory is safe to use.

The write probes capture the daemon's settings archive here before they change anything, and
`restore_pristine.py` reads it back from the same place, so the directory is fixed rather than
per-run. It sits at `<PROBE_OUT or the temp directory>/hqptuner-probe`. The archive is a full
copy of the daemon's configuration, so the directory must belong to the current user and grant
nothing to group or other: `prepare` creates it at mode 0700 when absent and reports anything
else it finds as unsafe, judged on the directory itself and never on a link's target.
"""

import contextlib
import os
import stat
import tempfile
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

DIR_NAME = "hqptuner-probe"
ARCHIVE_NAME = "pristine-settings.zip"
PRIVATE = 0o700
OTHERS = stat.S_IRWXG | stat.S_IRWXO


class Refusal(Enum):
    """Why a directory may not be used."""

    NOT_A_DIRECTORY = "is not a plain directory (a link or a file)"
    FOREIGN_OWNER = "is not owned by the current user"
    WIDE_MODE = "grants something to group or other; it must be mode 0700"


@dataclass(frozen=True)
class BackupDir:
    """The backup directory and, when it may not be used, the reason."""

    path: Path
    refusal: Refusal | None

    @property
    def safe(self) -> bool:
        """Whether the directory may be read from and written to."""
        return self.refusal is None

    @property
    def problem(self) -> str | None:
        """A message naming the directory and the refusal, or None when the directory is safe."""
        return None if self.refusal is None else f"{self.path} {self.refusal.value}; refusing to use it"

    @property
    def archive(self) -> Path:
        """Where the pristine archive lives inside the directory."""
        return self.path / ARCHIVE_NAME


def _refusal(path: Path, uid: int) -> Refusal | None:
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        return Refusal.NOT_A_DIRECTORY
    if info.st_uid != uid:
        return Refusal.FOREIGN_OWNER
    if info.st_mode & OTHERS:
        return Refusal.WIDE_MODE
    return None


def prepare(uid: int | None = None) -> BackupDir:
    """Create the directory at mode 0700 when absent, then report whether it is safe.

    `uid` is the owner the directory must have; it defaults to the current user.
    """
    path = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / DIR_NAME
    with contextlib.suppress(FileExistsError):
        path.mkdir(mode=PRIVATE, parents=True)
    return BackupDir(path, _refusal(path, os.getuid() if uid is None else uid))
