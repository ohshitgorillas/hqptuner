"""Fake hqplayerd metering side channel — real binary frames over a real TCP
socket (docs/protocol.md §7).

The real daemon streams unconditionally on bare accept, one frame per transform
hop. This fake does the same: whoever connects starts receiving frames — either
one payload repeated forever (``repeat=``, the endless-playback case), or
exactly the frames the test has enqueued with ``send`` (which is how a test
bounds how much coverage the wire ever carried)."""

import asyncio
import struct
import threading
from collections.abc import Iterator, Sequence

#: Frame header (protocol.md §7, little-endian): u32 version, channels,
#: xformLength, transformBits; f32 bandwidth, transformTime, gain; u32 reserved.
_HEADER = struct.Struct("<4I3fI")


def frame(
    levels_db: Sequence[float], bandwidth: float, transform_time: float, channels: int = 2, rms: float = -20.0
) -> bytes:
    """One wire frame carrying the given per-bin spectrum (dB) in every channel.

    Bin k sits at ``k * bandwidth / (len(levels_db) - 1)`` Hz. The transform is
    two consecutive halves — all reals, then all imaginaries (protocol.md §7) —
    so a bin at L dB becomes real ``10 ** (L / 20)``, imaginary 0. ``rms`` is
    the third float of every channel's level block (dBFS); pass a value below
    -90 to build a frame the receiver must treat as silent."""
    bins = len(levels_db)
    header = _HEADER.pack(1, channels, bins, 16, bandwidth, transform_time, 2.0, 0)
    reals = struct.pack(f"<{bins}f", *(10 ** (level / 20.0) for level in levels_db))
    imags = struct.pack(f"<{bins}f", *([0.0] * bins))
    meters = struct.pack("<4f", -6.0, -8.0, rms, -18.0)  # peakMax, peak, rms, rmsMax
    return header + (meters + reals + imags) * channels


class MeteringStream:
    """Listener on port 0 that streams frames to any client that connects."""

    def __init__(self, repeat: bytes | None = None, interval: float = 0.0) -> None:
        self._repeat = repeat
        self._interval = interval
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._flushed = asyncio.Event()
        self._flushed.set()
        self._server: asyncio.Server | None = None
        self._handlers: set[asyncio.Task[None]] = set()

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return int(self._server.sockets[0].getsockname()[1])

    def send(self, payload: bytes, count: int = 1) -> None:
        """Enqueue ``count`` copies of one frame for the connected client."""
        self._flushed.clear()
        for _ in range(count):
            self._queue.put_nowait(payload)

    async def flushed(self) -> None:
        """Wait until every queued frame has been written AND drained. Drain
        blocks on the socket buffer, so all but the buffered tail of a large
        batch has actually been read by the peer when this returns."""
        await self._flushed.wait()

    async def _serve(self, _reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is None:  # pragma: no cover — handlers always run as tasks
            return
        self._handlers.add(task)
        try:
            while True:
                if self._repeat is not None:
                    writer.write(self._repeat)
                    await writer.drain()
                    await asyncio.sleep(self._interval)
                    continue
                payload = await self._queue.get()
                writer.write(payload)
                await writer.drain()
                if self._queue.empty():
                    self._flushed.set()
        except ConnectionError:
            pass
        finally:
            self._handlers.discard(task)
            writer.close()

    async def close(self) -> None:
        for task in list(self._handlers):
            task.cancel()
        await asyncio.gather(*self._handlers, return_exceptions=True)
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()


def spawn_threaded_stream(repeat: bytes, interval: float = 0.005) -> Iterator[int]:
    """The same fake stream, served from a dedicated thread's event loop — for
    the sync `TestClient` cases, whose app (and its metering reader) runs in its
    own loop while the test's is parked (conftest's `spawn_threaded_daemon`).

    Frames are paced by ``interval`` rather than flooded: the real daemon emits
    one frame per transform hop (protocol.md §7), and a flood keeps the app's
    loop saturated for the whole `TestClient` teardown."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    stream = MeteringStream(repeat=repeat, interval=interval)
    port: int = asyncio.run_coroutine_threadsafe(stream.start(), loop).result()
    yield port
    asyncio.run_coroutine_threadsafe(stream.close(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()
