"""Every 8088 URL writes an IPv6 host in brackets (docs/testing.md).

The host is stored bare (``::1``); the request URL is where it is bracketed. Each case hands the code under test a
transport that records the URL of every request it is sent, and asserts on the origin it saw. A URL the client cannot
build is never sent, so a build that rejects the host leaves nothing recorded and the case reads "" as a value rather
than an error.
"""

import contextlib
from collections.abc import Awaitable, Callable

import httpx

from hqptuner.conf.httpauth import check_pair
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.engine.logtail import fetch_log
from hqptuner.engine.release import fetch_about

HOST = "::1"
PORT = 8088
BRACKETED = f"http://[{HOST}]:{PORT}"

#: How long a request waits; the transport answers at once, so the value is never reached.
WAIT = 1.0


class Recorder:
    """A transport that answers every request with an empty page and keeps each URL it was asked for."""

    def __init__(self) -> None:
        self.urls: list[str] = []
        self.transport = httpx.MockTransport(self._answer)

    def _answer(self, request: httpx.Request) -> httpx.Response:
        self.urls.append(str(request.url))
        return httpx.Response(200, text="<html></html>")

    @property
    def options(self) -> HttpOptions:
        return HttpOptions(timeout=WAIT, transport=self.transport)


async def _origin_sent(send: Callable[[Recorder], Awaitable[object]]) -> str:
    """The scheme, host and port of the first request ``send`` makes over a fresh recorder, or "" when it sends none."""
    recorder = Recorder()
    with contextlib.suppress(httpx.InvalidURL, ValueError):
        await send(recorder)
    if not recorder.urls:
        return ""
    sent = httpx.URL(recorder.urls[0])
    return f"{sent.scheme}://{sent.netloc.decode()}"


async def _read_config(recorder: Recorder) -> object:
    client = HttpConfigClient(HOST, PORT, "u", "p", recorder.options)
    try:
        return await client.get_config()
    finally:
        await client.aclose()


async def _check_pair(recorder: Recorder) -> object:
    return await check_pair(HOST, PORT, "u", "p", WAIT, transport=recorder.transport)


async def _fetch_log(recorder: Recorder) -> object:
    return await fetch_log(HOST, PORT, recorder.options)


async def _fetch_about(recorder: Recorder) -> object:
    return await fetch_about(Config(hqp_host=HOST, hqp_http_port=PORT).hqp_http_base_url, recorder.options)


async def test_the_config_client_brackets_an_ipv6_host() -> None:
    assert await _origin_sent(_read_config) == BRACKETED


async def test_the_pair_check_brackets_an_ipv6_host() -> None:
    assert await _origin_sent(_check_pair) == BRACKETED


async def test_the_log_fetch_brackets_an_ipv6_host() -> None:
    assert await _origin_sent(_fetch_log) == BRACKETED


async def test_the_about_fetch_brackets_an_ipv6_host() -> None:
    assert await _origin_sent(_fetch_about) == BRACKETED
