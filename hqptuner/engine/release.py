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


async def fetch_release(base_url: str) -> str:
    """Return the daemon's installed release string from GET /about, or "" when unreachable or unparseable."""
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get("/about")
            resp.raise_for_status()
            text = resp.text
    except httpx.HTTPError:
        return ""
    match = _VERSION_RE.search(text)
    return match.group(1) if match else ""
