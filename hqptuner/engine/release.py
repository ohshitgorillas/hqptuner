"""Installed-release readout from the daemon's /about page.

GetInfo's ``version`` is the bare major ("6") and ``engine`` is the DSP
engine's own build ("6.0.4"), which Signalyst numbers separately from the
release — neither is the installed release number. The only wire source of
that number is the port-8088 web interface's /about page, which prints it
under a "Version" heading (verified on 6.0.2: ``<h3>Version</h3>`` followed
by the bare number on its own line). Not credential-gated, like /log.
"""

import re

import httpx

_HTTP_TIMEOUT = 10.0  # httpx would otherwise default to 5.0
_VERSION_RE = re.compile(r"<h3>Version</h3>\s*([0-9][0-9A-Za-z.\-]*)")


async def fetch_about(base_url: str) -> str:
    """Return the daemon's raw /about page body, raising ``httpx.HTTPError`` when it cannot be fetched."""
    async with httpx.AsyncClient(base_url=base_url, timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get("/about")
        resp.raise_for_status()
        return resp.text


def parse_release(text: str) -> str:
    """Return the installed release string /about's "Version" heading names, or "" where it carries none."""
    match = _VERSION_RE.search(text)
    return match.group(1) if match else ""
