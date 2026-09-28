"""Where HQPTuner's files sit: the assets shipped with the code, and the directory the user's own data goes in.

A checkout and the container answer both questions with one directory, the package's own. A PyInstaller build
cannot: one-file unpacks the assets into a temp directory it deletes on exit, one-folder installs them where a
normal account has no write, so the read side and the write side part company there and only there.
"""

import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

_APP = "HQPTuner"


def _user_data_dir_win32(env: Mapping[str, str]) -> Path:
    """Windows convention: ``%LOCALAPPDATA%``, or its own default when that variable is unset."""
    local = env.get("LOCALAPPDATA", "").strip()
    return Path(local) / _APP if local else Path.home() / "AppData" / "Local" / _APP


def _user_data_dir_darwin(_env: Mapping[str, str]) -> Path:
    """MacOS convention: the fixed Application Support path. Takes ``env`` only to match the dispatch signature."""
    return Path.home() / "Library" / "Application Support" / _APP


def _user_data_dir_xdg(env: Mapping[str, str]) -> Path:
    """XDG basedir convention, the fallback for every platform that is neither Windows nor macOS.

    A value that is not an absolute path is ignored, so an empty or relative ``XDG_DATA_HOME`` falls through to the
    spec's own default.
    """
    xdg = env.get("XDG_DATA_HOME", "").strip()
    if xdg and Path(xdg).is_absolute():
        return Path(xdg) / "hqptuner"
    return Path.home() / ".local" / "share" / "hqptuner"


_USER_DATA_DIR_BY_PLATFORM: Mapping[str, Callable[[Mapping[str, str]], Path]] = {
    "win32": _user_data_dir_win32,
    "darwin": _user_data_dir_darwin,
}


def user_data_dir(platform: str = sys.platform, env: Mapping[str, str] = os.environ) -> Path:
    """Per-user writable base directory for HQPTuner's stores, by the convention of the platform it runs on.

    ``platform`` and ``env`` default to the live ``sys.platform`` and ``os.environ``, so a bare call reads the
    process it actually runs in; a caller pins either one to test the convention without touching either.
    """
    return _USER_DATA_DIR_BY_PLATFORM.get(platform, _user_data_dir_xdg)(env)


def bundled(*parts: str, bundle: Path | None = None) -> Path:
    """Locate a read-only bundled asset: inside the unpacked bundle when frozen, beside the package otherwise.

    ``bundle`` defaults to the live bundle root, resolved fresh from ``sys.frozen``/``sys._MEIPASS`` on every
    call that omits it — a frozen build's own root is only known once the process is running. A caller pins
    ``bundle`` to test either branch without touching either attribute.
    """
    if bundle is None:
        meipass = getattr(sys, "_MEIPASS", "")
        bundle = Path(meipass) if getattr(sys, "frozen", False) and meipass else None
    if bundle is not None:
        return bundle.joinpath(*parts)
    return Path(__file__).resolve().parent.joinpath(*parts)
