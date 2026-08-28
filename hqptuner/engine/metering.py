"""hqplayerd metering side-channel reader (TCP 4322, protocol.md §7).

A background task that keeps a per-track spectral aggregate for the
junk-filter advisor (``junkadvisor.py``). The daemon streams frames
unconditionally on bare accept, one per transform hop; the metering tap runs at
the *source* rate, so the aggregate sees the source spectrum directly even
while upsampling.

The stream is best-effort by design: connection refused, dropped, or absent
means "no recommendation", never a user-facing error. The reader reconnects
with a fixed backoff and throws the aggregate away whenever the stream or the
track context breaks, so a verdict is only ever computed over one track's
frames.

The connection is held only while the engine is playing. The daemon cannot be
asked to send less, so the socket is the only throttle there is, and an idle
stream is pure cost — megabytes a second of it once the traffic leaves loopback
for a Docker bridge. ``Config.metering_enabled`` turns the whole reader off.
"""

import asyncio
import contextlib
import logging
import math
import struct
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from hqptuner.engine import junkadvisor

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

HEADER = struct.Struct("<4I3fI")  # version, channels, bins, bits, bandwidth, xformTime, gain, reserved
PLAYING = 2
RECONNECT_DELAY = 5.0
# How long the reader waits before re-checking whether the engine started playing
# again. Shorter than the manager's own status poll, so the gate adds no latency
# of its own beyond the staleness of the status it reads.
IDLE_RECHECK = 1.0
# Ingest every Nth frame (~43/s at 44.1k). The aggregate is a long-run average;
# a quarter of the hops carries the same verdict at a quarter of the CPU.
DECIMATE = 4
MAX_CHANNELS = 32
MAX_BINS = 65_536

# The spur rule's persistence window: per-bin minima are folded into blocks of
# BLOCK_SECONDS coverage, and the window spectrum exists once WINDOW_BLOCKS
# full blocks have been earned (~30 s). A tone must persist through the whole
# window to survive the minimum — long enough that a sustained musical partial
# cannot fake it, short enough that a bias tone is caught within the first
# minute of a track.
BLOCK_SECONDS = 5.0
WINDOW_BLOCKS = 6
# Frames quieter than this on every channel (RMS dBFS) are kept out of the
# minimum: digital silence between songs carries no tone either, and one such
# frame would collapse every bin's minimum to the floor.
SILENT_RMS_DB = -90.0


@dataclass(frozen=True)
class TrackContext:
    """What the advisor needs to know about the engine's current track."""

    playing: bool
    track_serial: str | None
    samplerate: int | None
    sdm: bool
    junk_filter: str | None
    filter: str | None = None  # active main filter's display name


def context_from(manager: "ConnectionManager") -> TrackContext | None:
    """Return the reader's view of the manager's last poll — None while unreachable."""
    status = manager.status
    if not manager.reachable or status is None:
        return None
    meta = manager.status_metadata or {}
    rate = meta.get("samplerate")
    return TrackContext(
        playing=_int(status.get("state")) == PLAYING,
        track_serial=status.get("track_serial"),
        samplerate=_int(rate) if rate else None,
        sdm=meta.get("sdm") in ("1", "true"),
        junk_filter=_junk_filter_name(status, manager.enums),
        filter=status.get("active_filter") or None,
    )


def _junk_filter_name(status: dict[str, str], enums: dict[str, list[dict[str, str]]] | None) -> str | None:
    """``Status.filter_junk`` joined against the running enumeration.

    The engine is the sole authority for index→name (architecture §2).
    """
    idx = status.get("filter_junk")
    for item in (enums or {}).get("junk_filters", []):
        if item.get("index") == idx:
            return item.get("name")
    return None


def _int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


class SpectralAggregate:
    """Per-track mean power spectrum plus a windowed per-bin minimum.

    The mean is per-bin power sums over ingested frames. The minimum is kept
    block-wise: each BLOCK_SECONDS of coverage folds into one per-bin-min
    array, the last WINDOW_BLOCKS of which form the spur rule's persistence
    window. Silent frames never touch the minimum (they carry no tone either),
    and a block that saw only silence is dropped rather than pushed.
    """

    def __init__(self, bins: int, bandwidth: float) -> None:
        """Start an empty aggregate fixed to one frame geometry: zeroed power sums, no blocks, no coverage yet."""
        self.bins = bins
        self.bandwidth = bandwidth
        self.frames = 0
        self.seconds = 0.0
        self._power = [0.0] * bins
        self._blocks: deque[list[float]] = deque(maxlen=WINDOW_BLOCKS)
        self._block_min: list[float] | None = None
        self._block_seconds = 0.0

    def add(self, mags_sq: list[float], covered_seconds: float, *, silent: bool = False) -> None:
        """Fold one frame's per-bin power into the running sums and, unless silent, into the current block's minimum.

        Once the block has BLOCK_SECONDS of coverage it is pushed to the window and a fresh one starts; a block that
        saw only silent frames is dropped instead of pushed.
        """
        for i, p in enumerate(mags_sq):
            self._power[i] += p
        self.frames += 1
        self.seconds += covered_seconds
        if not silent:
            if self._block_min is None:
                self._block_min = list(mags_sq)
            else:
                block = self._block_min
                for i, p in enumerate(mags_sq):
                    block[i] = min(block[i], p)
        self._block_seconds += covered_seconds
        if self._block_seconds >= BLOCK_SECONDS:
            if self._block_min is not None:
                self._blocks.append(self._block_min)
            self._block_min = None
            self._block_seconds = 0.0

    def levels_db(self) -> list[float]:
        """Convert the mean power spectrum over every ingested frame to dB, empty bins floored at -200."""
        return [10 * math.log10(p / self.frames) if p > 0 else -200.0 for p in self._power]

    def window_min_db(self) -> list[float] | None:
        """Per-bin minimum (dB) over the last full persistence window, or None until WINDOW_BLOCKS full blocks exist.

        The current partial block joins the minimum too — it can only tighten it, never fake persistence.
        """
        if len(self._blocks) < WINDOW_BLOCKS:
            return None
        arrays: list[list[float]] = list(self._blocks)
        if self._block_min is not None:
            arrays.append(self._block_min)
        mins = [min(vals) for vals in zip(*arrays, strict=True)]
        return [10 * math.log10(p) if p > 0 else -200.0 for p in mins]


class MeteringReader:
    """Owns the 4322 connection and the current track's aggregate."""

    def __init__(
        self,
        host: str,
        port: int,
        context: Callable[[], TrackContext | None],
        *,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        """Record where the metering port is and how to read track context; nothing connects until ``run``.

        ``sleep`` is the test seam standing in for the reconnect backoff's wall clock.
        """
        self._host = host
        self._port = port
        self._context = context
        self._sleep = sleep
        self._stop = asyncio.Event()
        self._agg: SpectralAggregate | None = None
        self._serial: str | None = None
        self._verdict: dict[str, Any] | None = None

    def stop(self) -> None:
        """Ask the reader to shut down: the stream loop and the backoff wait both end at the next check."""
        self._stop.set()

    def verdict(self) -> dict[str, Any] | None:
        """Return the track's latched signature, whatever the engine currently has engaged.

        Computed on demand. A verdict latches for the rest of the track: the signature is a property of the source,
        and loud music masking it from the detector later in the track does not make it go away (the Ænima case — a
        persistent tone plainly visible on the spectrogram, drowned out of the mean spectrum once the music starts).
        The latch clears on track change or stream loss.

        Deliberately blind to the engaged filter, unlike ``recommendation``: auto-pilot engages what the signature
        asks for and has to keep seeing that signature afterwards, or it would lose the very evidence that says the
        filter is still earning its place.
        """
        ctx, agg = self._context(), self._agg
        if ctx is None or agg is None or agg.frames == 0:
            return None
        if ctx.track_serial != self._serial:
            self._verdict = None  # the aggregate is the old track's evidence
            return None
        fresh = junkadvisor.classify(
            agg.levels_db(),
            agg.bandwidth,
            agg.seconds,
            samplerate=ctx.samplerate,
            sdm=ctx.sdm,
            min_levels_db=agg.window_min_db(),
        )
        if fresh is not None:
            self._verdict = fresh
        return self._verdict

    def recommendation(self) -> dict[str, Any] | None:
        """Return the advisor's note for the current track, or None.

        The latched signature, minus the case where the engine already deals with it: the note goes quiet while the
        engaged junk filter — or, for spur verdicts, a main filter from a recommended family — treats it. Engaging is
        the user acting on the advice, disengaging brings the advice back.
        """
        verdict, ctx = self.verdict(), self._context()
        if verdict is None or ctx is None or junkadvisor.treats(verdict, ctx.junk_filter, ctx.filter):
            return None
        return verdict

    async def run(self) -> None:
        """Hold the stream only while the engine is playing, and reconnect after a backoff whenever it breaks.

        The daemon streams unconditionally on bare accept (protocol.md §7) — there is no way to ask it for less, so
        the only way to stop paying for frames nobody ingests is to close the socket. The reader therefore connects
        when the engine reports playing and disconnects when it stops, which on a bridged Docker network is the
        difference between megabytes a second of idle traffic and none.

        A broken stream is not an error: it is logged at debug and the aggregate and verdict are discarded, so a
        verdict is only ever computed over one unbroken run of one track's frames. A *deliberate* disconnect at the
        idle gate is not a break — a pause mid-track leaves the evidence standing, so the verdict survives it.
        """
        while not self._stop.is_set():
            keep = False
            delay = IDLE_RECHECK
            try:
                ctx = self._context()
                if ctx is None:
                    pass  # unreachable daemon: nothing to stream, and no evidence worth keeping
                elif ctx.playing:
                    keep = await self._stream()
                else:
                    keep = True  # paused mid-track: the aggregate is still this track's
            except (OSError, asyncio.IncompleteReadError) as exc:
                log.debug("metering stream unavailable: %s", exc)
                delay = RECONNECT_DELAY  # a refused or broken stream, not merely an idle engine
            if not keep:
                self._agg = None  # a broken stream ends the track's evidence
                self._verdict = None
            if not self._stop.is_set():
                await self._wait(delay)

    async def _wait(self, seconds: float) -> None:
        if self._sleep is not None:  # test seam — virtualized clock
            await self._sleep(seconds)
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stop.wait(), seconds)

    async def _stream(self) -> bool:
        """Ingest frames until the engine stops playing (True) or the loop is stopped (False).

        The play state is checked on a tick of its own rather than after each frame: a stream that goes quiet must
        still be let go, and blocking in ``readexactly`` until the next frame arrives would hold the socket open for
        as long as the daemon stays silent.
        """
        reader, writer = await asyncio.open_connection(self._host, self._port)
        log.info("metering stream connected (%s:%s)", self._host, self._port)
        read: asyncio.Task[tuple[tuple[float, ...], bytes]] | None = None
        try:
            frame = 0
            while not self._stop.is_set():
                ctx = self._context()
                if ctx is None or not ctx.playing:
                    return ctx is not None  # paused keeps the evidence; unreachable does not
                if read is None:
                    read = asyncio.create_task(self._read_frame(reader))
                if not await self._arrived(read):
                    continue  # the tick won: re-check the engine, leave the read running
                header, body = read.result()
                read = None
                frame += 1
                if frame % DECIMATE == 0:
                    self._ingest(header, body, ctx)
            return False
        finally:
            await _discard(read)
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()

    async def _arrived(self, read: "asyncio.Task[tuple[tuple[float, ...], bytes]]") -> bool:
        """Wait up to one idle tick for the pending frame; False means the tick won and the read is still running."""
        tick = asyncio.ensure_future(self._wait(IDLE_RECHECK))
        try:
            await asyncio.wait({read, tick}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            tick.cancel()
        return read.done()

    async def _read_frame(self, reader: asyncio.StreamReader) -> tuple[tuple[float, ...], bytes]:
        header = HEADER.unpack(await reader.readexactly(HEADER.size))
        channels, bins = int(header[1]), int(header[2])
        if not (0 < channels <= MAX_CHANNELS and 1 < bins <= MAX_BINS):
            raise OSError(f"implausible metering header (channels={channels}, bins={bins})")
        return header, await reader.readexactly(channels * (16 + 8 * bins))

    def _ingest(self, header: tuple[float, ...], body: bytes, ctx: TrackContext) -> None:
        channels, bins = int(header[1]), int(header[2])
        bandwidth, xform_time = float(header[4]), float(header[5])
        agg = self._agg
        if agg is None or ctx.track_serial != self._serial or agg.bins != bins or agg.bandwidth != bandwidth:
            agg = self._agg = SpectralAggregate(bins, bandwidth)
            self._serial = ctx.track_serial
            self._verdict = None
        agg.add(
            _frame_power(body, channels, bins),
            xform_time * DECIMATE,
            silent=_frame_silent(body, channels, bins),
        )


async def _discard(read: "asyncio.Task[tuple[tuple[float, ...], bytes]] | None") -> None:
    """Cancel a still-pending frame read and collect whatever it ended with, so nothing is left unretrieved."""
    if read is None:
        return
    read.cancel()
    with contextlib.suppress(asyncio.CancelledError, OSError, asyncio.IncompleteReadError):
        await read


def _frame_silent(body: bytes, channels: int, bins: int) -> bool:
    """Whether every channel's RMS sits below the silence threshold.

    The RMS is the third float of the per-channel level block (protocol.md §7).
    """
    stride = 16 + 8 * bins
    return all(struct.unpack_from("<f", body, ch * stride + 8)[0] < SILENT_RMS_DB for ch in range(channels))


def _frame_power(body: bytes, channels: int, bins: int) -> list[float]:
    """Channel-summed squared magnitudes.

    The transform block is two consecutive halves (reals then imaginaries, not interleaved) — protocol.md §7.
    """
    power = [0.0] * bins
    stride = 16 + 8 * bins
    for ch in range(channels):
        vals = struct.unpack_from(f"<{2 * bins}f", body, ch * stride + 16)
        for k in range(bins):
            power[k] += vals[k] ** 2 + vals[bins + k] ** 2
    return power
