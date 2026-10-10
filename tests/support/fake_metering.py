"""The fake hqplayerd metering side channel (4322) — real frames over a real socket.

The frames are the caller's: this module packs no spectrum and derives nothing,
it streams the bytes it was handed (docs/testing.md rule 13). A client that
connects is sent ``frames`` copies of that frame back to back and then held
open, so a reader keeps its socket for the length of the case and the fake
never spins: once the reader's buffer is full the send blocks, and once the
frames are out the connection parks on a read that returns when the reader
hangs up.

A caller that needs the music to go on hands in a ``Stream`` instead of one
frame. ``Stream.play`` sends a new passage to every connection already held
open and makes it what each later connection is sent on accept, so a reader
that dials after the passage changed is not left waiting on one it missed. The
fake sends a passage once, as fast as the reader takes it; it never paces the
frames on a clock, where the daemon sends one per transform hop as the music
plays.

The server runs in its own thread over real TCP, like `conftest`'s
`spawn_threaded_daemon`: the app under test runs its own event loop inside
`TestClient`'s thread, where an in-loop asyncio fake is unreachable.

A caller that hands in an ``Accepted`` reads how many connections the fake
took. The count is final once the fake is torn down: teardown wakes the
server thread with a connection of its own, which the thread recognises by
its address and does not count, and the thread drains every connection
queued ahead of it before it ends.
"""

import contextlib
import socket
import threading
from collections.abc import Iterator
from dataclasses import dataclass

#: How long a torn-down server thread gets to notice, in seconds. Only a
#: deadlock reaches it; the shutdown below is by socket, not by waiting.
JOIN_SECONDS = 5.0


@dataclass
class Accepted:
    """How many client connections the fake accepted, final once it is torn down."""

    count: int = 0


class Stream:
    """The passage the fake sends: ``frames`` copies of ``frame``, to each connection as it is accepted.

    ``play`` changes the passage and sends it at once to every connection held open. One lock covers both sends, so
    a passage never lands in the middle of another on the same connection.
    """

    def __init__(self, frame: bytes = b"", frames: int = 0) -> None:
        """Start with the passage every connection is sent on accept; the default sends nothing until ``play``."""
        self._lock = threading.Lock()
        self._frame = frame
        self._frames = frames
        self._open: list[socket.socket] = []

    def play(self, frame: bytes, frames: int) -> None:
        """Send ``frames`` copies of ``frame`` to every open connection, and to each one accepted from now on."""
        with self._lock:
            self._frame, self._frames = frame, frames
            for connection in self._open:
                with contextlib.suppress(OSError):
                    _send(connection, frame, frames)

    def attach(self, connection: socket.socket) -> None:
        """Send a newly accepted connection the current passage and hold it open for the next."""
        with self._lock:
            self._open.append(connection)
            _send(connection, self._frame, self._frames)

    def detach(self, connection: socket.socket) -> None:
        """Stop sending to a connection the reader has hung up."""
        with self._lock:
            if connection in self._open:
                self._open.remove(connection)


def _send(connection: socket.socket, frame: bytes, frames: int) -> None:
    for _ in range(frames):
        connection.sendall(frame)


def spawn(frame: bytes, frames: int = 100, host: str = "127.0.0.1", accepted: Accepted | None = None) -> Iterator[int]:
    """Serve ``frames`` copies of ``frame`` to each connection on an ephemeral port; shaped for a yield fixture."""
    yield from spawn_stream(Stream(frame, frames), host, accepted)


def spawn_stream(stream: Stream, host: str = "127.0.0.1", accepted: Accepted | None = None) -> Iterator[int]:
    """Serve ``stream`` on an ephemeral port; shaped for a yield fixture."""
    tally = Accepted() if accepted is None else accepted
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((host, 0))
    listener.listen(2)
    port: int = listener.getsockname()[1]
    stopping = threading.Event()
    live: list[socket.socket] = []
    waker: list[tuple[str, int]] = []

    def serve() -> None:
        while True:
            try:
                connection, peer = listener.accept()
            except OSError:
                return
            if peer in waker:
                connection.close()
                return
            tally.count += 1
            if stopping.is_set():
                connection.close()
                continue
            live.append(connection)
            with connection, contextlib.suppress(OSError):
                try:
                    stream.attach(connection)
                    connection.recv(1)  # park until the reader hangs up
                finally:
                    stream.detach(connection)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    yield port
    stopping.set()
    for connection in live:
        with contextlib.suppress(OSError):
            connection.shutdown(socket.SHUT_RDWR)
    wake = socket.socket()
    wake.bind((host, 0))
    waker.append(wake.getsockname())
    with wake, contextlib.suppress(OSError):  # unblock a thread parked in accept()
        wake.connect((host, port))
        thread.join(JOIN_SECONDS)
    listener.close()
    thread.join(JOIN_SECONDS)
