"""The suite's one in-process network: every fake daemon is reached through it, and no offline test opens a socket
to another process or to a port (docs/testing.md rule 4, rule 16).

A test registers a fake at a ``(host, port)`` and hands the app this module's ``NETWORK`` through the constructor,
the way it hands in a ``VirtualClock``. The stream half is here: a stream fake is an asyncio stream callback, in the
shape of ``fake_control.serve_shared``. Dialing a registered address makes a connected ``socket.socketpair()``,
gives the caller one end as asyncio streams and starts the callback on the other end, on the loop doing the
dialing, so the fake answers on a test's loop or on a ``TestClient``'s app loop with no thread and no listener. The
pair is AF_UNIX and never leaves the process, and the client's own asyncio stream code runs unchanged over a real
kernel stream. Dialing an address nothing is registered at is refused, which is what a closed TCP port gives.

The desktop launcher's port knock gets a stand-in socket: it connects (answers 0) where any fake is served, stream
or 8088, and is refused anywhere else.

A discovery responder is a table from the exact request bytes to a reply. The network's datagram socket looks the
responder up at the address it sends to and queues that table's reply for the exact bytes, with the responder's own
address as the sender, so a search reads it on its next pass. A target nobody answers at, the multicast group
included, is silent.

The 8088 half has no socket at all. A fake is a function from the request bytes to the response bytes, and the
network's transport turns each ``httpx.Request`` into those bytes, hands them over and reads the answer back into an
``httpx.Response``, inline on the thread that sent the request. An address nothing serves, or one withdrawn, raises
``httpx.ConnectError``; an answer that is no HTTP response raises ``httpx.RemoteProtocolError``, as httpcore does.
"""

import asyncio
import contextlib
import errno
import functools
import re
import socket
import threading
from collections import deque
from collections.abc import Awaitable, Callable, Iterator, Mapping

import httpx

from hqptuner.core.network import Network

#: The shape of a stream fake: the callback an asyncio server runs for each connection.
StreamCallback = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]

#: The shape of an 8088 fake: the bytes of one HTTP/1.1 request in, the bytes the daemon writes back out.
HttpFake = Callable[[bytes], bytes]

#: Where a fake is registered when the test names no host.
LOOPBACK = "127.0.0.1"

_LOCK = threading.Lock()
_STREAMS: dict[tuple[str, int], StreamCallback] = {}
_HTTP: dict[tuple[str, int], HttpFake] = {}
_DATAGRAMS: dict[tuple[str, int], Mapping[bytes, bytes]] = {}
_CLOSED_PORTS: set[int] = set()
#: For each live fake end, by file descriptor, the caller's end of its pair.
_PEERS: dict[int, socket.socket] = {}
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
def _registered[F](table: dict[tuple[str, int], F], fake: F, host: str, port: int | None) -> Iterator[int]:
    """Put ``fake`` in ``table`` at ``host`` and ``port`` for the block, yielding the port.

    With no port (None or 0) the number is drawn so that it can never equal one ``closed_port`` returned or one the
    session holds: a bound socket that never listens keeps it for as long as the registration lasts.
    """
    holder: socket.socket | None = None
    if not port:
        holder, port = _hold_port()
    address = (host, port)
    with _LOCK:
        table[address] = fake
    try:
        yield port
    finally:
        with _LOCK:
            table.pop(address, None)
        if holder is not None:
            holder.close()


def serving(
    callback: StreamCallback, host: str = LOOPBACK, port: int | None = None
) -> contextlib.AbstractContextManager[int]:
    """Serve the stream fake ``callback`` at ``host`` and ``port`` for the block, yielding the port."""
    return _registered(_STREAMS, callback, host, port)


def serving_http(
    fake: HttpFake, host: str = LOOPBACK, port: int | None = None
) -> contextlib.AbstractContextManager[int]:
    """Serve the 8088 fake ``fake`` at ``host`` and ``port`` for the block, yielding the port."""
    return _registered(_HTTP, fake, host, port)


def responding(
    replies: Mapping[bytes, bytes], host: str = LOOPBACK, port: int | None = None
) -> contextlib.AbstractContextManager[int]:
    """Answer the discovery datagrams ``replies`` names at ``host`` and ``port`` for the block, yielding the port."""
    return _registered(_DATAGRAMS, replies, host, port)


def withdraw_http(host: str, port: int) -> None:
    """Take the 8088 fake at ``host`` and ``port`` away, so every later request meets a refused connection."""
    with _LOCK:
        _HTTP.pop((host, port), None)


async def _run_fake(callback: StreamCallback, sock: socket.socket, caller: socket.socket) -> None:
    key = sock.fileno()
    with _LOCK:
        _PEERS[key] = caller
    reader, writer = await asyncio.open_connection(sock=sock)
    try:
        await callback(reader, writer)
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()
        with _LOCK:
            _PEERS.pop(key, None)


def reset(writer: asyncio.StreamWriter) -> None:
    """Close the fake's end of a connection so that the caller's next read fails with ``ECONNRESET``, which is what a
    TCP close with unread data gives. A byte the caller never sent is left unread on the fake's end, and the kernel
    answers a close of an end that holds unread bytes with a reset to the other end: the caller's own transport meets
    the error as it meets a TCP reset. Call it from the fake's callback, once its last read is done."""
    key = writer.get_extra_info("socket").fileno()
    writer.close()
    with _LOCK:
        caller = _PEERS.get(key)
    if caller is not None:
        with contextlib.suppress(OSError):
            caller.send(b"\0")


async def open_stream(host: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Dial ``host`` and ``port`` in process: the streams of the caller's end of a fresh connected pair."""
    with _LOCK:
        callback = _STREAMS.get((host, port))
    if callback is None:
        raise ConnectionRefusedError(111, "Connection refused")
    ours, theirs = socket.socketpair()
    task = asyncio.get_running_loop().create_task(_run_fake(callback, theirs, ours))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return await asyncio.open_connection(sock=ours)


class _Datagrams:
    """A datagram socket that reaches the registered responders: a send queues the reply, a receive pops it."""

    def __init__(self) -> None:
        self.timeout: float | None = None
        self._replies: deque[tuple[bytes, tuple[str, int]]] = deque()

    def settimeout(self, value: float | None, /) -> None:
        self.timeout = value

    def sendto(self, data: bytes, address: tuple[str, int], /) -> int:
        with _LOCK:
            table = _DATAGRAMS.get(address)
        reply = None if table is None else table.get(data)
        if reply is not None:
            self._replies.append((reply, address))
        return len(data)

    def recvfrom(self, _bufsize: int, /) -> tuple[bytes, tuple[str, int]]:
        if not self._replies:
            raise BlockingIOError
        return self._replies.popleft()

    def close(self) -> None:
        self._replies.clear()


class Knock:
    """The socket the desktop launcher's port knock uses: it keeps the timeout it was given and answers from the
    registry. Made the way ``socket.socket`` is, from a family, a kind and a protocol it has no use for."""

    def __init__(self, _family: int = 0, _kind: int = 0, _proto: int = 0) -> None:
        self.timeout: float | None = None
        self.asked: list[tuple[object, ...]] = []

    def __enter__(self) -> "Knock":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def settimeout(self, value: float | None, /) -> None:
        self.timeout = value

    def connect_ex(self, address: tuple[object, ...], /) -> int:
        self.asked.append(address)
        with _LOCK:
            served = address[:2] in _STREAMS or address[:2] in _HTTP
        return 0 if served else errno.ECONNREFUSED


_NO_RESPONSE = "Server disconnected without sending a response."
_SHORT_BODY = "peer closed connection without sending complete message body"
_NOBODY_HOME = "All connection attempts failed"
_STATUS_LINE = re.compile(rb"HTTP/1\.[01] (\d{3})(?: [^\r\n]*)?")


def _request_bytes(request: httpx.Request) -> bytes:
    head = [f"{request.method} {request.url.raw_path.decode()} HTTP/1.1".encode()]
    head += [name + b": " + value for name, value in request.headers.raw]
    return b"\r\n".join(head) + b"\r\n\r\n" + request.content


def _response(raw: bytes, request: httpx.Request) -> httpx.Response:
    """Read what a daemon wrote as an ``httpx.Response``: a body bounded by its Content-Length, else by the close."""
    head, separator, body = raw.partition(b"\r\n\r\n")
    lines = head.split(b"\r\n")
    status = _STATUS_LINE.fullmatch(lines[0])
    if not separator or status is None:
        raise httpx.RemoteProtocolError(_NO_RESPONSE, request=request)
    headers = [(name.strip(), value.strip()) for name, _, value in (line.partition(b":") for line in lines[1:])]
    lengths = [int(value) for name, value in headers if name.lower() == b"content-length"]
    if lengths and len(body) < lengths[0]:
        raise httpx.RemoteProtocolError(_SHORT_BODY, request=request)
    kept = [(name, value) for name, value in headers if name.lower() != b"content-length"]
    return httpx.Response(int(status.group(1)), headers=kept, content=body[: lengths[0]] if lengths else body)


def _answer(host: str, port: int, request: httpx.Request) -> httpx.Response:
    with _LOCK:
        fake = _HTTP.get((host, port))
    if fake is None:
        raise httpx.ConnectError(_NOBODY_HOME, request=request)
    return _response(fake(_request_bytes(request)), request)


def http_transport(host: str, port: int) -> httpx.MockTransport:
    """A fresh transport for the 8088 address, answering both an async and a sync client."""
    return httpx.MockTransport(functools.partial(_answer, host, port))


#: The network the suite hands the manager and the app: every dial it makes is answered by a fake registered here.
NETWORK = Network(open_stream=open_stream, http_transport=http_transport, open_datagram=_Datagrams)
