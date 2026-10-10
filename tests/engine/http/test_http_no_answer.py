"""What the 8088 web-interface lane reports when HQPlayer does not answer a request in time.

The timeout on this lane is httpx's own, so no clock of ours reaches it. The fake is the transport instead, handed
in through the constructor: it raises the timeout httpx raises when the reply never comes, at once.

The sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the test put
there: the timeout the configuration client was built with, which the report carries as its seconds, and httpx's
own text for the timeout, which it no longer carries.
"""

import re
from collections.abc import Awaitable, Callable

import httpx
import pytest

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions

#: Two production-sized timeouts, so a report that names one fixed number of seconds is wrong on the other.
TIMEOUTS = [10.0, 25.0]

#: Two texts httpx gives a timeout, so a report that passes either through shows it on one of them.
HTTPX_TEXTS = ["timed out", "The read operation timed out"]

#: What a request is handed instead of a reply when nothing raised.
NO_ERROR = ""


def _numbers(text: str) -> list[float]:
    """Every number written in ``text``."""
    return [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]


def _silent(text: str) -> httpx.MockTransport:
    """A transport on which HQPlayer answers nothing: every request times out reading, with ``text``."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(text, request=request)

    return httpx.MockTransport(handler)


async def _report(request: Callable[[], Awaitable[object]]) -> str:
    """The text of the error ``request`` raises, or ``NO_ERROR``."""
    try:
        await request()
    except httpx.HTTPError as exc:
        return str(exc)
    return NO_ERROR


def _client(seconds: float, text: str) -> HttpConfigClient:
    return HttpConfigClient("hqplayer.invalid", 8088, "u", "p", HttpOptions(timeout=seconds, transport=_silent(text)))


async def _read(seconds: float, text: str) -> str:
    client = _client(seconds, text)
    try:
        return await _report(client.get_config)
    finally:
        await client.aclose()


async def _write(seconds: float, text: str) -> str:
    client = _client(seconds, text)
    try:
        return await _report(lambda: client.post_profile("save", name="silent"))
    finally:
        await client.aclose()


@pytest.mark.parametrize("seconds", TIMEOUTS)
@pytest.mark.parametrize("request_", [_read, _write], ids=["read", "write"])
async def test_a_config_request_hqplayer_does_not_answer_reports_the_seconds_it_waited(
    request_: Callable[[float, str], Awaitable[str]], seconds: float
) -> None:
    assert _numbers(await request_(seconds, HTTPX_TEXTS[0])) == [seconds]


@pytest.mark.parametrize("text", HTTPX_TEXTS)
@pytest.mark.parametrize("request_", [_read, _write], ids=["read", "write"])
async def test_a_config_request_hqplayer_does_not_answer_is_not_reported_in_httpx_words(
    request_: Callable[[float, str], Awaitable[str]], text: str
) -> None:
    assert text not in await request_(TIMEOUTS[0], text)
