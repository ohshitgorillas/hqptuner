"""A daemon that answers the discovery datagram (docs/protocol.md §2), served
from the running test's own event loop.

The reply is looked up in a table the test writes, keyed by the exact request
bytes: nothing here derives an answer, so a client that sends a different
document is answered with silence rather than with a reply the fake invented.
The socket binds an ephemeral port on a caller-named loopback address, so a
search can be pointed at an address that is not the one the container-host
alias names.
"""

import asyncio
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Any


class _Responder(asyncio.DatagramProtocol):
    def __init__(self, replies: Mapping[bytes, bytes]) -> None:
        self.replies = replies
        self.transport: asyncio.DatagramTransport | None = None

    def datagram_received(self, data: bytes, addr: tuple[str | Any, int]) -> None:
        answer = self.replies.get(data)
        if answer is not None and self.transport is not None:
            self.transport.sendto(answer, addr)


@asynccontextmanager
async def responder(replies: Mapping[bytes, bytes], host: str = "127.0.0.2") -> AsyncIterator[int]:
    """Answer `replies` on an ephemeral UDP port at `host`, yielding the port."""
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(lambda: _Responder(replies), local_addr=(host, 0))
    protocol.transport = transport
    try:
        yield int(transport.get_extra_info("sockname")[1])
    finally:
        transport.close()
