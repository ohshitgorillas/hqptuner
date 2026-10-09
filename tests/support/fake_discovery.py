"""A daemon that answers the discovery datagram (docs/protocol.md §2), served
from the running test's own event loop.

The reply is looked up in a table the test writes, keyed by the exact request
bytes: nothing here derives an answer, so a client that sends a different
document is answered with silence rather than with a reply the fake invented.
The socket binds an ephemeral port on a caller-named loopback address, so a
search can be pointed at an address that is not the one the container-host
alias names.

The listener is a reader callback on a non-blocking socket rather than the
loop's socket calls, so the same fake answers on the standard loop and on
uvloop, which does not provide ``sock_recvfrom`` or ``sock_sendto``.
"""

import asyncio
import socket
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager


def _answer(sock: socket.socket, replies: Mapping[bytes, bytes]) -> None:
    """Read the one datagram waiting, answering it where the table knows it."""
    request, sender = sock.recvfrom(4096)
    reply = replies.get(request)
    if reply is not None:
        sock.sendto(reply, sender)


@asynccontextmanager
async def responder(replies: Mapping[bytes, bytes], host: str = "127.0.0.2") -> AsyncIterator[int]:
    """Answer `replies` on an ephemeral UDP port at `host`, yielding the port.

    The socket is bound before the port is handed out, so a request sent before
    the loop's first read is held by the kernel rather than lost."""
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0)  # non-blocking: the reader is called only when a datagram is waiting
    sock.bind((host, 0))
    loop.add_reader(sock.fileno(), _answer, sock, replies)
    try:
        yield int(sock.getsockname()[1])
    finally:
        loop.remove_reader(sock.fileno())
        sock.close()
