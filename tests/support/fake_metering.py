"""The fake hqplayerd metering side channel (4322) — real frames over a real socket.

The frames are the caller's: this module packs no spectrum and derives nothing,
it streams the bytes it was handed (docs/testing.md rule 13). A client that
connects is sent ``frames`` copies of that frame back to back and then held
open, so a reader keeps its socket for the length of the case and the fake
never spins: once the reader's buffer is full the send blocks, and once the
frames are out the connection parks on a read that returns when the reader
hangs up.

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


def spawn(frame: bytes, frames: int = 100, host: str = "127.0.0.1", accepted: Accepted | None = None) -> Iterator[int]:
    """Serve the 4322 stream on an ephemeral port; shaped for a yield fixture."""
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
                for _ in range(frames):
                    connection.sendall(frame)
                connection.recv(1)  # park until the reader hangs up

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
