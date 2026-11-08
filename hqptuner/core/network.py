"""The ways the app opens a connection to the daemon (docs/testing.md rule 16), handed to the manager and the app.

Production takes the defaults below, each asyncio's or httpx's own call. The suite hands in a network whose fakes
answer in process, so no offline test opens a connection to another process.
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from hqptuner.engine.control import Opener

#: What carries an 8088 request to a host and a port: a transport that answers it, or None for httpx's own.
HttpTransportFor = Callable[[str, int], httpx.AsyncBaseTransport | None]


def own_transport(_host: str, _port: int) -> None:
    """Answer None: the 8088 request goes over httpx's own socket transport."""


@dataclass(frozen=True)
class Network:
    """The connections one manager and its lanes open.

    ``http_transport`` answers a fresh transport on every call, because an ``httpx.AsyncClient`` closes the one it
    was given when it closes.
    """

    open_stream: Opener = asyncio.open_connection
    http_transport: HttpTransportFor = own_transport
