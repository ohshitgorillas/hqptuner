"""Static tail of the hqplayerd log (System-tab live view).

The daemon serves its log over the port-8088 web interface (GET /log) — the same
lane HQPTuner already uses for config. Reading it there means the tail works
regardless of the daemon's `<log file>` setting (file, journal, or custom path)
and needs no host bind mount into the container. GET /log is not credential-
gated, so this reads it without auth — the System-tab tail stays available
before login, like the rest of the read-only surface.
"""

import httpx

from hqptuner.conf.httpconf import HttpRefusedError, hqplayer_request, raise_refused
from hqptuner.conf.httpforms import ConfigForm

_TAIL_CAP = 256 * 1024  # only decode the last 256 KiB — a large log never blows up memory
_HTTP_TIMEOUT = 10.0  # httpx would otherwise default to 5.0
_HTTP_DEFAULT_PORT = 80  # what a base URL that names no port is dialed on
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


async def fetch_log(base_url: str, *, transport: httpx.AsyncBaseTransport | None = None) -> str:
    """Return the daemon's full log text from GET /log on the 8088 web interface.

    Unauthenticated — the log page is not credential-gated. ``transport`` replaces httpx's own socket transport;
    left out, the request goes over the network. A 404 raises ``NoLogError``, any other error status
    ``HttpRefusedError``.
    """
    url = httpx.URL(base_url)
    async with httpx.AsyncClient(base_url=base_url, timeout=_HTTP_TIMEOUT, transport=transport) as client:
        with hqplayer_request(url.host, url.port or _HTTP_DEFAULT_PORT, _HTTP_TIMEOUT):
            resp = await client.get("/log")
        if resp.status_code == _NO_LOG:
            raise NoLogError(response=resp)
        raise_refused(resp)
        return resp.text


def tail_text(text: str, lines: int) -> list[str]:
    """Last `lines` lines of the log text, decoding only its tail."""
    if len(text) > _TAIL_CAP:
        text = text[-_TAIL_CAP:]
    return text.splitlines()[-lines:]
