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
import socket
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager, suppress


async def _answer(sock: socket.socket, replies: Mapping[bytes, bytes]) -> None:
    """Read datagrams until cancelled, answering the ones the table knows."""
    loop = asyncio.get_running_loop()
    while True:
        request, sender = await loop.sock_recvfrom(sock, 4096)
        reply = replies.get(request)
        if reply is not None:
            await loop.sock_sendto(sock, reply, sender)


@asynccontextmanager
async def responder(replies: Mapping[bytes, bytes], host: str = "127.0.0.2") -> AsyncIterator[int]:
    """Answer `replies` on an ephemeral UDP port at `host`, yielding the port.

    The socket is bound before the port is handed out, so a request sent before
    the reader's first pass is held by the kernel rather than lost."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0)  # non-blocking, which is what the loop's socket calls require
    sock.bind((host, 0))
    reading = asyncio.create_task(_answer(sock, replies))
    try:
        yield int(sock.getsockname()[1])
    finally:
        reading.cancel()
        with suppress(asyncio.CancelledError):
            await reading
        sock.close()
