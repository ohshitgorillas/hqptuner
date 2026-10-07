"""Static tail of the hqplayerd log (System-tab live view).

The daemon serves its log over the port-8088 web interface (GET /log) — the same
lane HQPTuner already uses for config. Reading it there means the tail works
regardless of the daemon's `<log file>` setting (file, journal, or custom path)
and needs no host bind mount into the container. GET /log is not credential-
gated, so this reads it without auth — the System-tab tail stays available
before login, like the rest of the read-only surface.
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from hqptuner.conf.httpforms import ConfigForm

_TAIL_CAP = 256 * 1024  # only decode the last 256 KiB — a large log never blows up memory
_HTTP_TIMEOUT = 10.0  # httpx would otherwise default to 5.0


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


@dataclass(frozen=True)
class _Held:
    """One log text, the URL it was fetched from, and the reader-clock time it arrived."""

    url: str
    text: str
    at: float


def _settled(task: "asyncio.Task[str]") -> None:
    """Retrieve a finished fetch's outcome, so one whose every caller was cancelled fails quietly."""
    if not task.cancelled():
        task.exception()


class LogReader:
    """The daemon's GET /log on the 8088 web interface, read through one client and shared between callers.

    Unauthenticated — the log page is not credential-gated. A whole log is the costliest read on that lane, so the
    last text fetched is held and served to any caller whose ``max_age`` it satisfies, and callers arriving while a
    fetch is in flight wait on that fetch rather than starting their own. The text is held against the URL it came
    from: a caller naming another URL (the daemon moved) is never served the old daemon's log.
    """

    def __init__(self, monotonic: Callable[[], float]) -> None:
        """Build the client; ``monotonic`` is the clock a held text's age is measured on."""
        self._monotonic = monotonic
        self._client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
        self._held: _Held | None = None
        self._inflight: tuple[str, asyncio.Task[str]] | None = None

    async def read(self, base_url: str, max_age: float = 0.0) -> str:
        """Return the log text of the daemon at ``base_url``, fetched less than ``max_age`` seconds ago.

        ``max_age`` 0 always fetches, or joins a fetch already in flight. A daemon that cannot be reached, or
        answers with an error status, raises ``httpx.HTTPError``.
        """
        url = f"{base_url}/log"
        held = self._held
        if held is not None and held.url == url and self._monotonic() - held.at < max_age:
            return held.text
        if self._inflight is None or self._inflight[0] != url:
            task = asyncio.ensure_future(self._fetch(url))
            task.add_done_callback(_settled)
            self._inflight = (url, task)
        # Shielded: one caller cancelled (a browser tab closing) must not cancel the fetch the others wait on.
        return await asyncio.shield(self._inflight[1])

    async def _fetch(self, url: str) -> str:
        """Fetch the log at ``url`` and hold it; the in-flight slot is freed whichever way the fetch ends."""
        try:
            resp = await self._client.get(url)
            resp.raise_for_status()
        finally:
            if self._inflight is not None and self._inflight[1] is asyncio.current_task():
                self._inflight = None
        self._held = _Held(url, resp.text, self._monotonic())
        return resp.text

    async def aclose(self) -> None:
        """Close the client."""
        await self._client.aclose()


def tail_text(text: str, lines: int) -> list[str]:
    """Last `lines` lines of the log text, decoding only its tail."""
    if len(text) > _TAIL_CAP:
        text = text[-_TAIL_CAP:]
    return text.splitlines()[-lines:]
