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

from hqptuner.conf.httpconf import HttpOptions
from hqptuner.conf.noanswer import IDENTITY_ONLY, reply_ceiling, under_total

# The most of the page that is read, a refusal past it. The page is a few KB, so 64 KiB is far more than it needs.
ABOUT_CEILING = 64 * 1024
_VERSION_RE = re.compile(r"<h3>Version</h3>\s*([0-9][0-9A-Za-z.\-]*)")


async def fetch_about(base_url: str, options: HttpOptions | None = None) -> str:
    """Return the daemon's raw /about page body, raising ``httpx.HTTPError`` when it cannot be fetched.

    Sent on ``options``, or the defaults: ten seconds, where httpx would otherwise wait five. The exchange ends at the
    total deadline on ``options`` and the page is read up to ``ABOUT_CEILING``.
    """
    options = options or HttpOptions()
    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=options.timeout,
        transport=options.transport,
        headers=IDENTITY_ONLY,
        event_hooks=reply_ceiling(lambda _path: ABOUT_CEILING),
    ) as client:
        resp = await under_total(options.deadline, options.timeout, client.get("/about"))
        resp.raise_for_status()
        return resp.text


def parse_release(text: str) -> str:
    """Return the installed release string /about's "Version" heading names, or "" where it carries none."""
    match = _VERSION_RE.search(text)
    return match.group(1) if match else ""
