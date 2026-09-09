"""Where HQPTuner's files sit: the assets shipped with the code, and the directory the user's own data goes in.

A checkout and the container answer both questions with one directory, the package's own. A PyInstaller build
cannot: one-file unpacks the assets into a temp directory it deletes on exit, one-folder installs them where a
normal account has no write, so the read side and the write side part company there and only there.
"""

import os
import sys
from pathlib import Path

_APP = "HQPTuner"


def user_data_dir() -> Path:
    """Per-user writable base directory for HQPTuner's stores, by the convention of the platform it runs on."""
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "").strip()
        return Path(local) / _APP if local else Path.home() / "AppData" / "Local" / _APP
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / _APP
    # XDG basedir: a value that is not an absolute path is ignored, so an empty
    # or relative XDG_DATA_HOME falls through to the spec's own default.
    xdg = os.environ.get("XDG_DATA_HOME", "").strip()
    if xdg and Path(xdg).is_absolute():
        return Path(xdg) / "hqptuner"
    return Path.home() / ".local" / "share" / "hqptuner"


def bundled(*parts: str) -> Path:
    """Locate a read-only bundled asset: inside the unpacked bundle when frozen, beside the package otherwise."""
    meipass = getattr(sys, "_MEIPASS", "")
    if getattr(sys, "frozen", False) and meipass:
        return Path(meipass).joinpath(*parts)
    return Path(__file__).resolve().parent.joinpath(*parts)
