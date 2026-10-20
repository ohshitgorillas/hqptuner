"""Shutting the manager down leaves nothing open.

``aclose`` closes the control connection the manager holds, every 8088 client a credentials change replaced, and the
log reader. A replaced 8088 client stays open until then, since a write in flight may still hold it, so shutdown is
where it is closed.

Each closure is read off the far side: the Control API fake counts the connections still open from the daemon's end, a
replaced 8088 client's transport records being closed, and a keep-alive 8088 fake records the log reader hanging up.
"""

import asyncio
import contextlib
import functools
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from apps import READY_CEILING, settled
from counted_control import Connections, counted_daemon, still_open, within_passes
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager

#: Clients a case builds: the one the manager starts with, and two that each replace the one before.
CLIENTS = 3

#: Control connections left open once the manager has shut down.
NONE_OPEN = 0

#: What the keep-alive 8088 fake serves at ``GET /log``.
LOG_BODY = b"log line 1\nlog line 2\n"

#: The keep-alive 8088 fake's answer to every request: an HTTP/1.1 200, which leaves the connection open.
LOG_RESPONSE = b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n%s" % (len(LOG_BODY), LOG_BODY)


class _ClosingTransport(httpx.MockTransport):
    """The wire under one 8088 client: answers every request 200 and records whether the client closed it."""

    def __init__(self) -> None:
        super().__init__(lambda _: httpx.Response(200))
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


#: A client on its own recording transport.
Client = tuple[HttpConfigClient, _ClosingTransport]


@pytest.fixture
async def client() -> AsyncIterator[Callable[[], Client]]:
    """Build 8088 clients, each on a transport of its own, closing every one at teardown."""
    built: list[HttpConfigClient] = []

    def build() -> Client:
        transport = _ClosingTransport()
        http = HttpConfigClient("hqplayer.invalid", 8088, "u", "p", HttpOptions(transport=transport))
        built.append(http)
        return http, transport

    yield build
    for http in built:
        await http.aclose()


async def _keep_alive_log(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    accepted: list[asyncio.StreamWriter],
    hung_up: asyncio.Event,
) -> None:
    """Answer every request on one connection with ``LOG_RESPONSE``, keeping it open, and set ``hung_up`` once the
    client closes it; the connection's writer is added to ``accepted``."""
    accepted.append(writer)
    try:
        with contextlib.suppress(asyncio.IncompleteReadError, ConnectionError):
            while True:
                await reader.readuntil(b"\r\n\r\n")
                writer.write(LOG_RESPONSE)
                await writer.drain()
    finally:
        hung_up.set()
        writer.close()


@pytest.fixture
async def log_daemon() -> AsyncIterator[tuple[int, asyncio.Event]]:
    """A keep-alive 8088 fake on the test's own loop: its port, and the event its handler sets when a client hangs
    up. Teardown closes the fake's end of every connection a client left open, so the server can finish closing."""
    accepted: list[asyncio.StreamWriter] = []
    hung_up = asyncio.Event()
    handler = functools.partial(_keep_alive_log, accepted=accepted, hung_up=hung_up)
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    try:
        yield int(server.sockets[0].getsockname()[1]), hung_up
    finally:
        server.close()
        for writer in accepted:
            writer.close()
        await server.wait_closed()


@pytest.fixture
async def holding(clock: VirtualClock) -> AsyncIterator[tuple[ConnectionManager, Connections]]:
    """A running manager holding a control connection to the Control API fake, idle on the clock, and the fake's
    connections; its run is stopped at teardown."""
    async with counted_daemon(clock) as daemon:
        manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=daemon.port), clock=clock)
        task = clock.spawn(manager.run())
        await settled(clock)
        yield manager, daemon.connections
        manager.stop()
        await asyncio.wait_for(task, READY_CEILING)
        await manager.aclose()


async def test_shutdown_closes_the_control_connection_the_manager_holds(
    holding: tuple[ConnectionManager, Connections],
) -> None:
    manager, connections = holding
    await manager.aclose()
    assert await still_open(connections) == NONE_OPEN


@pytest.mark.parametrize("replaced", [0, 1], ids=["first_replaced", "second_replaced"])
async def test_shutdown_closes_every_8088_client_a_credentials_change_replaced(
    client: Callable[[], Client], clock: VirtualClock, replaced: int
) -> None:
    clients = [client() for _ in range(CLIENTS)]
    manager = ConnectionManager(Config(), clients[0][0], clock)
    for http, _ in clients[1:]:
        manager.http_client = http
    await manager.aclose()
    assert clients[replaced][1].closed is True


async def test_shutdown_closes_the_log_reader(log_daemon: tuple[int, asyncio.Event], clock: VirtualClock) -> None:
    port, hung_up = log_daemon
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_http_port=port), clock=clock)
    await engineread.read_log_tail(manager)
    await manager.aclose()
    assert await within_passes(hung_up.is_set) is True
