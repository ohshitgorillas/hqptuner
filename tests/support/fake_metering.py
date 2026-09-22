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
"""

import contextlib
import socket
import threading
from collections.abc import Iterator

#: How long a torn-down server thread gets to notice, in seconds. Only a
#: deadlock reaches it; the shutdown below is by socket, not by waiting.
JOIN_SECONDS = 5.0


def spawn(frame: bytes, frames: int = 100, host: str = "127.0.0.1") -> Iterator[int]:
    """Serve the 4322 stream on an ephemeral port; shaped for a yield fixture."""
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((host, 0))
    listener.listen(1)
    port: int = listener.getsockname()[1]
    stopping = threading.Event()
    live: list[socket.socket] = []

    def serve() -> None:
        while not stopping.is_set():
            try:
                connection, _peer = listener.accept()
            except OSError:
                return
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
    with contextlib.suppress(OSError):  # unblock a thread parked in accept()
        socket.create_connection((host, port)).close()
    listener.close()
    thread.join(JOIN_SECONDS)
