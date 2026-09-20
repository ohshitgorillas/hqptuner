"""hqplayerd metering side-channel reader (TCP 4322, protocol.md §7).

A background task that keeps a spectral aggregate for the
junk-filter advisor (``junkadvisor.py``). The daemon streams frames
unconditionally on bare accept, one per transform hop; the metering tap runs at
the *source* rate, so the aggregate sees the source spectrum directly even
while upsampling.

The stream is best-effort by design: connection refused, dropped, or absent
means "no recommendation", never a user-facing error. The reader reconnects
with a fixed backoff and throws the aggregate away whenever the stream breaks
or the frame geometry changes; a track change is neither, so the evidence in
hand survives one.

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

from hqptuner.engine import blockstats, junkadvisor

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
# Ingest every Nth frame (~43/s at 44.1k). The block statistics are read off
# the frames a block kept, at the rate the corpus they are graded against was
# captured at, so every hop is ingested.
DECIMATE = 1
MAX_CHANNELS = 32
MAX_BINS = 65_536

# The detector's persistence window: per-bin minima are folded into blocks of
# BLOCK_SECONDS coverage, and the window spectrum is the minimum over the last
# WINDOW_BLOCKS of them (~30 s) plus whatever partial block is open. A tone must
# persist through the coverage in hand to survive the minimum, and once the
# window is full that coverage is long enough that a sustained musical partial
# cannot fake it. The window is how far back the minimum reaches; it is not a
# wait, and the first frame folded already carries a readable spectrum.
BLOCK_SECONDS = 1.0
WINDOW_BLOCKS = 30
# Frames quieter than this on every channel (RMS dBFS) are kept out of the
# minimum: digital silence between songs carries no tone either, and one such
# frame would collapse every bin's minimum to the floor.
SILENT_RMS_DB = -90.0


@dataclass(frozen=True)
class TrackContext:
    """What the advisor needs to know about the engine's current track."""

    playing: bool
    samplerate: int | None
    sdm: bool
    junk_filter: str | None
    filter: str | None = None  # active main filter's display name


def context_from(manager: "ConnectionManager") -> TrackContext | None:
    """Return the reader's view of the manager's last poll — None while unreachable."""
    status = manager.readings.status
    if not manager.reachable or status is None:
        return None
    meta = manager.readings.status_metadata or {}
    rate = meta.get("samplerate")
    return TrackContext(
        playing=_int(status.get("state")) == PLAYING,
        samplerate=_int(rate) if rate else None,
        sdm=meta.get("sdm") in ("1", "true"),
        junk_filter=_junk_filter_name(manager.readings.state or {}, manager.readings.enums),
        filter=status.get("active_filter") or None,
    )


def _junk_filter_name(state: dict[str, str], enums: dict[str, list[dict[str, str]]] | None) -> str | None:
    """``State.filter_junk`` joined against the running enumeration.

    The engine is the sole authority for index→name (architecture §2).

    Read off State rather than Status, though both carry it: State's attribute table lists it unconditionally, while
    Status's is documented as a superset (`protocol.md` §6) — the same caveat that makes `filter1x`/`filterNx` a
    fall-back there. A frame that happens not to carry it would otherwise read as nothing engaged, which is the one
    answer that must not be guessed: it decides whether the advisor's note goes quiet and what auto-pilot falls back to.
    """
    idx = state.get("filter_junk")
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
    """Per-track windowed per-bin minimum power spectrum, and the statistics of each closed block.

    Each BLOCK_SECONDS of coverage closes one block, whose non-silent frames are read into a
    ``blockstats.BlockRecord``: the per-bin minimum the persistence window is folded from, the per-bin 90th
    percentile, and the three band scalars. The last WINDOW_BLOCKS records form the window. Silent frames never
    reach a record (they carry no signature either), and a block that saw only silence closes carrying none.
    """

    def __init__(self, bins: int, bandwidth: float) -> None:
        """Start an empty aggregate fixed to one frame geometry: no blocks, no coverage yet."""
        self.bins = bins
        self.bandwidth = bandwidth
        self.frames = 0
        self.seconds = 0.0
        self._blocks: deque[blockstats.BlockRecord] = deque(maxlen=WINDOW_BLOCKS)
        self._latest: blockstats.BlockRecord | None = None
        self._rows: list[list[float]] = []
        self._block_min: list[float] | None = None
        self._block_seconds = 0.0

    def add(self, mags_sq: list[float], covered_seconds: float, *, silent: bool = False) -> None:
        """Keep one frame's per-bin power, unless silent, in the open block.

        Once the block has BLOCK_SECONDS of coverage it is read into a record and a fresh one starts; a block that
        saw only silent frames closes carrying no record.
        """
        self.frames += 1
        self.seconds += covered_seconds
        if not silent:
            self._rows.append(mags_sq)
            if self._block_min is None:
                self._block_min = list(mags_sq)
            else:
                block = self._block_min
                for i, p in enumerate(mags_sq):
                    block[i] = min(block[i], p)
        self._block_seconds += covered_seconds
        if self._block_seconds >= BLOCK_SECONDS:
            self._latest = blockstats.block_record(self._rows, self.bandwidth) if self._rows else None
            if self._latest is not None:
                self._blocks.append(self._latest)
            self._rows = []
            self._block_min = None
            self._block_seconds = 0.0

    def latest_block(self) -> blockstats.BlockRecord | None:
        """Return the record of the block that closed most recently, or None while none has closed.

        A block that closes carrying no frame is the outcome of that close, so a silent second clears the reading
        rather than leaving the second before it in front of the rules.
        """
        return self._latest

    def window_min_db(self) -> list[float] | None:
        """Per-bin minimum (dB) over whatever coverage is in hand, or None while no frame has been folded at all.

        The closed blocks and the current partial one are read together, full window or not: WINDOW_BLOCKS is how far
        back the minimum reaches, not a wait the reader serves before anything can be said.
        """
        arrays: list[list[float]] = [record.minimum for record in self._blocks]
        if self._block_min is not None:
            arrays.append([10 * math.log10(p) if p > 0 else -200.0 for p in self._block_min])
        if not arrays:
            return None
        return [min(vals) for vals in zip(*arrays, strict=True)]


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
        self._holder = junkadvisor.SpurHolder()

    def retarget(self, host: str, port: int) -> None:
        """Point the reader at another daemon; the next dial uses it.

        The address is read at ``open_connection`` time rather than latched at construction, so a connection setting
        the user changed at runtime reaches the metering side channel with the reconnect the manager already forces.
        """
        self._host = host
        self._port = port

    def stop(self) -> None:
        """Ask the reader to shut down: the stream loop and the backoff wait both end at the next check."""
        self._stop.set()

    def aggregate(self) -> SpectralAggregate | None:
        """Return the aggregate the reader is accumulating, or None while there is no evidence to read."""
        return self._agg

    def verdict(self) -> dict[str, Any] | None:
        """Return the signature the current windowed minimum spectrum carries, whatever the engine has engaged.

        The cliff and the ramp are recomputed on every call and held by nothing: each is a property of the spectrum in
        front of the rules, so it appears when the window carries the signature and is None again once it does not. The
        spur is held per bin by the reader's ``SpurHolder`` until the tone's excess over the local baseline falls under
        the release split or the bin stops standing clear of the floor, so a loud passage that lifts the baseline over a
        tone no longer drops the advice and brings it back. The holder carries no track identity and neither does the
        aggregate: a held bin releases when the rules stop seeing it, not when the track changes.

        Deliberately blind to the engaged filter, unlike ``recommendation``: auto-pilot engages what the signature
        asks for and has to keep seeing that signature afterwards, or it would lose the very evidence that says the
        filter is still earning its place.
        """
        ctx, agg = self._context(), self._agg
        if ctx is None or agg is None:
            return None
        return junkadvisor.classify(
            agg.window_min_db(),
            agg.bandwidth,
            samplerate=ctx.samplerate,
            sdm=ctx.sdm,
            holder=self._holder,
            block=agg.latest_block(),
        )

    def recommendation(self) -> dict[str, Any] | None:
        """Return the advisor's note for the current track, or None.

        The live signature, minus the case where the engine already deals with it: the note goes quiet while the
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
        verdict is only ever computed over one unbroken run of frames. A *deliberate* disconnect at the idle gate is
        not a break — a pause leaves the evidence standing, so the verdict survives it, and so does a track change.
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
                    keep = True  # paused: keep the aggregate for the resume
            except (OSError, asyncio.IncompleteReadError) as exc:
                log.debug("metering stream unavailable: %s", exc)
                delay = RECONNECT_DELAY  # a refused or broken stream, not merely an idle engine
            if not keep:
                self._agg = None  # a broken stream ends the track's evidence
                self._holder = junkadvisor.SpurHolder()  # and the spur hold that rested on it
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
                    self._ingest(header, body)
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

    def _ingest(self, header: tuple[float, ...], body: bytes) -> None:
        channels, bins = int(header[1]), int(header[2])
        bandwidth, xform_time = float(header[4]), float(header[5])
        agg = self._agg
        if agg is None or agg.bins != bins or agg.bandwidth != bandwidth:
            agg = self._agg = SpectralAggregate(bins, bandwidth)
        agg.add(
            _frame_power(body, channels, bins),
            xform_time,
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
