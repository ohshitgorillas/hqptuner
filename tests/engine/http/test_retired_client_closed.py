"""A replaced 8088 client is closed once nothing holds it, and a request holding it finishes on it.

Each client here sits on a transport that records whether it was closed. A client replaced while idle is closed at
once. A client replaced while a request is paused on its transport stays open until that request ends, then closes,
and the request gets the answer its own client's transport gave. The request is a route taking ``HttpMgr``, the way
every route reaches the client, so the hold is the one the app takes.

The close is a task the replacement starts, so each case gives it one turn of the loop (``asyncio.sleep(0)``).
"""

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from conftest import StartManager
from fastapi import FastAPI, Response

from hqptuner.api.deps import HttpMgr
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.core.manager import ConnectionManager

HOST = "hqplayer.invalid"

#: How many clients the repeated-replacement case walks through.
REPLACEMENTS = 10


class Recording(httpx.MockTransport):
    """A transport that answers ``answer`` to every request and remembers whether it was closed."""

    def __init__(self, answer: bytes = b"") -> None:
        super().__init__(lambda _: httpx.Response(200, stream=httpx.ByteStream(answer)))
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class Paused(Recording):
    """A recording transport whose request waits on ``release`` once it has reached the transport."""

    def __init__(self, answer: bytes) -> None:
        super().__init__(answer)
        self.reached = asyncio.Event()
        self.release = asyncio.Event()
        self.handler = self._answer
        self._body = answer

    async def _answer(self, _: httpx.Request) -> httpx.Response:
        self.reached.set()
        await self.release.wait()
        return httpx.Response(200, stream=httpx.ByteStream(self._body))


def _client(transport: httpx.AsyncBaseTransport) -> HttpConfigClient:
    return HttpConfigClient(HOST, 8088, "u", "p", HttpOptions(transport=transport))


@pytest.fixture
async def ready(start_manager: StartManager, http_daemon: dict[str, Any]) -> ConnectionManager:
    """A manager running on both lanes and ready, before any case replaces its 8088 client."""
    return await start_manager(http_daemon["_port"])


def _manager(ready: ConnectionManager, client: HttpConfigClient) -> ConnectionManager:
    """``ready``, with ``client`` as the 8088 client in service."""
    ready.http_client = client
    return ready


async def test_a_client_replaced_while_idle_is_closed_at_once_and_the_one_in_service_is_not(
    ready: ConnectionManager,
) -> None:
    old, current = Recording(), Recording()
    manager = _manager(ready, _client(old))
    manager.http_client = _client(current)
    await asyncio.sleep(0)
    assert [old.closed, current.closed] == [True, False]


async def _closed_after_each_of_many_replacements(ready: ConnectionManager) -> list[bool]:
    transports = [Recording() for _ in range(REPLACEMENTS)]
    manager = _manager(ready, _client(transports[0]))
    for transport in transports[1:]:
        manager.http_client = _client(transport)
    await asyncio.sleep(0)
    return [transport.closed for transport in transports[:-1]]


async def test_every_client_a_run_of_replacements_replaced_is_closed(ready: ConnectionManager) -> None:
    assert await _closed_after_each_of_many_replacements(ready) == [True] * (REPLACEMENTS - 1)


@dataclass(frozen=True)
class Replaced:
    """What a request that began on a client saw while another client replaced it, and after."""

    closed_while_held: bool
    closed_after: bool
    answer: bytes


def _backup_route(manager: ConnectionManager) -> FastAPI:
    app = FastAPI()
    app.state.manager = manager

    @app.get("/backup")
    async def backup(mgr: HttpMgr) -> Response:
        return Response(await mgr.require_http().backup())

    return app


async def _replaced_under_a_request(ready: ConnectionManager, answer: bytes) -> Replaced:
    old = Paused(answer)
    manager = _manager(ready, _client(old))
    browser = httpx.AsyncClient(transport=httpx.ASGITransport(app=_backup_route(manager)), base_url="http://app")
    request = asyncio.create_task(browser.get("/backup"))
    await old.reached.wait()
    manager.http_client = _client(Recording())
    await asyncio.sleep(0)
    closed_while_held = old.closed
    old.release.set()
    served = await request
    await asyncio.sleep(0)
    await browser.aclose()
    return Replaced(closed_while_held, old.closed, served.content)


async def test_a_client_replaced_under_a_request_closes_only_when_the_request_ends(ready: ConnectionManager) -> None:
    replaced = await _replaced_under_a_request(ready, b"zip")
    assert [replaced.closed_while_held, replaced.closed_after] == [False, True]


@pytest.mark.parametrize("answer", [b"first archive", b"a second, longer archive"])
async def test_a_request_replaced_under_finishes_with_its_own_clients_answer(
    ready: ConnectionManager, answer: bytes
) -> None:
    assert (await _replaced_under_a_request(ready, answer)).answer == answer
