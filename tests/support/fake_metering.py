"""The fake hqplayerd metering side channel (4322) — real frames over a real socket.

The frames are the caller's: the server derives nothing, it streams the bytes it
was handed, and ``mono_frame`` packs the wire layout around the tables the caller
passes it. ``FLAT_FRAME`` and ``spur_frame`` are the two frames the suites share. A client that
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
server thread with a connection of its own, which the thread recognizes by
its address and does not count, and the thread drains every connection
queued ahead of it before it ends.
"""

import contextlib
import socket
import struct
import threading
from collections.abc import Iterator, Sequence
from dataclasses import dataclass

#: How long a torn-down server thread gets to notice, in seconds. Only a
#: deadlock reaches it; the shutdown below is by socket, not by waiting.
JOIN_SECONDS = 5.0


#: The four ``f32`` levels in dBFS every frame carries ahead of its transform.
LEVELS = (-3.0, -6.0, -20.0, -18.0)

#: The bins of a frame's transform.
BINS = 1025


def mono_frame(
    *, bandwidth: float, transform_time: float, bits: int, gain: float, reals: Sequence[float], imags: Sequence[float]
) -> bytes:
    """One single-channel frame: a ``<4I3fI`` header, ``LEVELS``, then the reals and the imaginaries."""
    header = struct.pack("<4I3fI", 1, 1, len(reals), bits, bandwidth, transform_time, gain, 0)
    return header + struct.pack(f"<4f{len(reals) + len(imags)}f", *LEVELS, *reals, *imags)


#: A frame of a 44.1 kHz source with no tone in it: a -60 dB floor in every real and imaginary.
FLAT_FRAME = mono_frame(
    bandwidth=22050.0, transform_time=1024 / 44100, bits=16, gain=2.0, reals=[1e-3] * BINS, imags=[1e-3] * BINS
)


def spur_frame(*, source_rate: int, spur_khz: float, transform_time: float) -> bytes:
    """A frame of a ``source_rate`` source whose transform carries a -60 dB floor and one 0 dB bin at ``spur_khz``:
    a persistent tone the reader's spur rule reads."""
    bandwidth = source_rate / 2
    reals = [1e-3] * BINS
    reals[round(spur_khz * 1000 * (BINS - 1) / bandwidth)] = 1.0
    return mono_frame(
        bandwidth=bandwidth, transform_time=transform_time, bits=11, gain=0.0, reals=reals, imags=[0.0] * BINS
    )


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
