"""The suite's one in-process network: every fake daemon is reached through it, and no offline test opens a socket
to another process or to a port (docs/testing.md rule 4, rule 16).

A test registers a fake at a ``(host, port)`` and hands the app this module's ``NETWORK`` through the constructor,
the way it hands in a ``VirtualClock``. The stream half is here: a stream fake is an asyncio stream callback, in the
shape of ``fake_control.serve_shared``. Dialing a registered address makes a connected ``socket.socketpair()``,
gives the caller one end as asyncio streams and starts the callback on the other end, on the loop doing the
dialing, so the fake answers on a test's loop or on a ``TestClient``'s app loop with no thread and no listener. The
pair is AF_UNIX and never leaves the process, and the client's own asyncio stream code runs unchanged over a real
kernel stream. Dialing an address nothing is registered at is refused, which is what a closed TCP port gives.
"""

import asyncio
import contextlib
import socket
import threading
from collections.abc import Awaitable, Callable, Iterator

from hqptuner.core.network import Network

#: The shape of a stream fake, as ``asyncio.start_server`` takes it.
StreamCallback = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]

#: Where a fake is registered when the test names no host.
LOOPBACK = "127.0.0.1"

_LOCK = threading.Lock()
_STREAMS: dict[tuple[str, int], StreamCallback] = {}
_CLOSED_PORTS: set[int] = set()
#: Fake ends still running, held so the loop does not drop a task mid-flight.
_RUNNING: set[asyncio.Task[None]] = set()


def record_closed_port(port: int) -> None:
    """Remember a port ``closed_port`` handed out, so no registration made later takes its number."""
    with _LOCK:
        _CLOSED_PORTS.add(port)


def _hold_port() -> tuple[socket.socket, int]:
    """Bind a loopback port no ``closed_port`` handed out. The socket never listens, so a dial is refused by the
    kernel as well, and the kernel gives the number to no later bind while the socket is open."""
    rejected: list[socket.socket] = []
    try:
        while True:
            holder = socket.socket()
            holder.bind((LOOPBACK, 0))
            port = int(holder.getsockname()[1])
            with _LOCK:
                taken = port in _CLOSED_PORTS
            if not taken:
                return holder, port
            rejected.append(holder)
    finally:
        for sock in rejected:
            sock.close()


@contextlib.contextmanager
def serving(callback: StreamCallback, host: str = LOOPBACK, port: int | None = None) -> Iterator[int]:
    """Serve ``callback`` at ``host`` and ``port`` for the block, yielding the port.

    With no port the number is drawn so that it can never equal one ``closed_port`` returned or one the session
    holds: a bound socket that never listens keeps it for as long as the registration lasts.
    """
    holder: socket.socket | None = None
    if port is None:
        holder, port = _hold_port()
    address = (host, port)
    with _LOCK:
        _STREAMS[address] = callback
    try:
        yield port
    finally:
        with _LOCK:
            _STREAMS.pop(address, None)
        if holder is not None:
            holder.close()


async def _run_fake(callback: StreamCallback, sock: socket.socket) -> None:
    reader, writer = await asyncio.open_connection(sock=sock)
    try:
        await callback(reader, writer)
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()


async def open_stream(host: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Dial ``host`` and ``port`` in process: the streams of the caller's end of a fresh connected pair."""
    with _LOCK:
        callback = _STREAMS.get((host, port))
    if callback is None:
        raise ConnectionRefusedError(111, "Connection refused")
    ours, theirs = socket.socketpair()
    task = asyncio.get_running_loop().create_task(_run_fake(callback, theirs))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return await asyncio.open_connection(sock=ours)


#: The network the suite hands the manager and the app: every dial it makes is answered by a fake registered here.
NETWORK = Network(open_stream=open_stream)
