"""Static tail of the hqplayerd log file (System-tab live view).

Pure helpers, no daemon socket: the running config points at the log file (the
`log_file` / `log_enabled` fields of GET /config), and this reads its tail.
"""

from pathlib import Path
from typing import Any

_TAIL_CAP = 256 * 1024  # only decode the last 256 KiB — a large log never blows up memory


def log_file_field(config_form: dict[str, Any] | None) -> tuple[str | None, bool]:
    """The configured log file path + whether logging is enabled, from a parsed
    GET /config form. Returns (None, False) when the form isn't loaded yet."""
    if not config_form:
        return None, False
    path: str | None = None
    enabled = False
    for field in config_form.get("fields", []):
        if field.get("name") == "log_file":
            path = (field.get("value") or "").strip() or None
        elif field.get("name") == "log_enabled":
            enabled = bool(field.get("value"))
    return path, enabled


def tail_file(path: str, lines: int) -> list[str]:
    """Last `lines` lines of the file, reading only its tail."""
    data = Path(path).read_bytes()
    if len(data) > _TAIL_CAP:
        data = data[-_TAIL_CAP:]
    return data.decode("utf-8", "replace").splitlines()[-lines:]
