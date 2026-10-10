"""Static tail of the hqplayerd log (System-tab live view).

The daemon serves its log over the port-8088 web interface (GET /log) — the same
lane HQPTuner already uses for config. Reading it there means the tail works
regardless of the daemon's `<log file>` setting (file, journal, or custom path)
and needs no host bind mount into the container. GET /log is not credential-
gated, so this reads it without auth — the System-tab tail stays available
before login, like the rest of the read-only surface.
"""

import httpx

from hqptuner.conf.httpauth import HttpRefusedError
from hqptuner.conf.httpconf import HttpOptions, hqplayer_request
from hqptuner.conf.httpforms import ConfigForm

_TAIL_CAP = 256 * 1024  # only decode the last 256 KiB — a large log never blows up memory
_NO_LOG = 404  # HQPlayer's answer on /log when it has no log to serve


class NoLogError(HttpRefusedError):
    """HQPlayer answered its own log page 404: it has no log to serve."""


def log_file_field(config_form: ConfigForm | None) -> tuple[str | None, bool]:
    """Return the configured log file path + whether logging is enabled, from a parsed GET /config form.

    Returns (None, False) when the form isn't loaded yet.
    """
    if not config_form:
        return None, False
    path: str | None = None
    enabled = False
    for field in config_form.get("fields", []):
        if field.get("name") == "log_file":
            value = field.get("value")
            path = (value.strip() or None) if isinstance(value, str) else None
        elif field.get("name") == "log_enabled":
            enabled = bool(field.get("value"))
    return path, enabled


async def fetch_log(host: str, port: int, options: HttpOptions | None = None) -> str:
    """Return the daemon's full log text from GET /log on the 8088 web interface at ``host:port``.

    Unauthenticated — the log page is not credential-gated. Sent on ``options``, or the defaults. A 404 raises
    ``NoLogError``, any other error status ``HttpRefusedError``.
    """
    options = options or HttpOptions()
    async with httpx.AsyncClient(
        base_url=f"http://{host}:{port}", timeout=options.timeout, transport=options.transport
    ) as client:
        with hqplayer_request(host, port, options.timeout):
            resp = await client.get("/log")
        if resp.status_code == _NO_LOG:
            raise NoLogError(response=resp)
        if not resp.is_success:
            raise HttpRefusedError(response=resp)
        return resp.text


def tail_text(text: str, lines: int) -> list[str]:
    """Last `lines` lines of the log text, decoding only its tail."""
    if len(text) > _TAIL_CAP:
        text = text[-_TAIL_CAP:]
    return text.splitlines()[-lines:]
