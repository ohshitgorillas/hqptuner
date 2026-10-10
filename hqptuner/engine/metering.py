"""hqplayerd metering side-channel reader (TCP 4322, protocol.md §7).

A background task that keeps a spectral aggregate for the junk-filter advisor (``junkadvisor.py``). The daemon streams
frames unconditionally on bare accept, one per transform hop; the metering tap runs at the *source* rate, so the
aggregate sees the source spectrum directly even while upsampling.

The stream is best-effort by design: connection refused, dropped, or absent
means "no recommendation", never a user-facing error. The reader reconnects
with a fixed backoff and throws the aggregate away whenever the stream breaks
or the frame geometry changes; a track change is neither, so the evidence in
hand survives one.

The connection is held only while the engine is playing and something reads
the stream: the advisor, or a subscriber to the meters' feed. The daemon cannot
be asked to send less, so the socket is the only throttle there is, and an
unread stream is pure cost — megabytes a second of it once the traffic leaves
loopback for a Docker bridge. ``Config.metering_enabled`` turns the whole reader
off.
"""

import asyncio
import contextlib
import logging
import math
import struct
from collections import deque
from collections.abc import Awaitable, Callable

import numpy as np
import numpy.typing as npt

from hqptuner.engine import blockstats, junkadvisor, junkrun
from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.meterfeed import MeterFeed, reduce_frame
from hqptuner.engine.trackcontext import TrackContext

log = logging.getLogger(__name__)

HEADER = struct.Struct("<4I3fI")  # version, channels, bins, bits, bandwidth, xformTime, gain, reserved
RECONNECT_DELAY = 5.0
# How long the reader waits before re-checking whether the engine started playing again. Shorter than the manager's
# own status poll, so the gate adds no latency of its own beyond the staleness of the status it reads.
IDLE_RECHECK = 1.0
# Ingest every Nth frame (~43/s at 44.1k). The block statistics are read off the frames a block kept, at the rate the
# corpus they are graded against was captured at, so every hop is ingested.
DECIMATE = 1
MAX_CHANNELS = 32
MAX_BINS = 65_536
# Frames quieter than this on every channel (RMS dBFS) carry no tone; the reduced frame carries the rms as power.
SILENT_RMS_DB = -90.0
SILENT_RMS_POWER = 10 ** (SILENT_RMS_DB / 10)

# The detector's persistence window: per-bin minima are folded into blocks of
# BLOCK_SECONDS coverage, and the window spectrum is the minimum over the last
# WINDOW_BLOCKS of them (~30 s) plus whatever partial block is open. A tone must
# persist through the coverage in hand to survive the minimum, and once the
# window is full that coverage is long enough that a sustained musical partial
# cannot fake it. The window is how far back the minimum reaches; it is not a
# wait, and the first frame folded already carries a readable spectrum.
BLOCK_SECONDS = 1.0
WINDOW_BLOCKS = 30


class ImplausibleMeteringHeaderError(OSError):
    """A metering frame's header carries a channel or bin count outside the sane range.

    Subclasses ``OSError`` on purpose: the reader's callers already catch ``OSError`` as "this socket is
    unusable", which a header this far off the wire's own limits is.
    """

    def __init__(self, *, channels: int, bins: int) -> None:
        """Render the wording naming the implausible channel and bin counts."""
        super().__init__(f"implausible metering header (channels={channels}, bins={bins})")


class SpectralAggregate:
    """Per-track windowed per-bin minimum power spectrum, and the statistics of each closed block.

    Each BLOCK_SECONDS of coverage closes one block, whose non-silent frames are read into a
    ``blockstats.BlockRecord``: the per-bin minimum the persistence window is folded from, the per-bin 90th
    percentile, and the three band scalars. The last WINDOW_BLOCKS records form the window. Silent frames never
    reach a record (they carry no signature either), and a block that saw only silence closes carrying none.

    Every block reaches ``junk_run`` as it closes, whatever the caller's poll does, so the 20k run rule reads the
    blocks themselves rather than the ones a poll happened to land on.
    """

    def __init__(self, bins: int, bandwidth: float) -> None:
        """Start an empty aggregate fixed to one frame geometry: no blocks, no coverage yet."""
        self.bins = bins
        self.bandwidth = bandwidth
        self.frames = 0
        self.seconds = 0.0
        self.junk_run = junkrun.JunkRun()
        self._blocks: deque[blockstats.BlockRecord] = deque(maxlen=WINDOW_BLOCKS)
        self._latest: blockstats.BlockRecord | None = None
        self._rows: list[list[float]] = []
        self._block_min: npt.NDArray[np.float64] | None = None
        self._block_seconds = 0.0

    def add(self, mags_sq: list[float], covered_seconds: float, *, silent: bool = False) -> bool:
        """Keep one frame's per-bin power, unless silent, in the open block, and say whether this frame closed it.

        Once the block has BLOCK_SECONDS of coverage it is read into a record and a fresh one starts; a block that
        saw only silent frames closes carrying no record.
        """
        self.frames += 1
        self.seconds += covered_seconds
        if not silent:
            self._rows.append(mags_sq)
            row = np.array(mags_sq, dtype=np.float64)
            if self._block_min is None:
                self._block_min = row
            else:
                np.minimum(self._block_min, row, out=self._block_min)
        self._block_seconds += covered_seconds
        if self._block_seconds < BLOCK_SECONDS:
            return False
        self._latest = blockstats.block_record(self._rows, self.bandwidth) if self._rows else None
        if self._latest is not None:
            self._blocks.append(self._latest)
        self.junk_run.observe(self._latest, self.bandwidth)
        self._rows = []
        self._block_min = None
        self._block_seconds = 0.0
        return True

    def window_min_db(self) -> list[float]:
        """Per-bin minimum (dB) over whatever coverage is in hand, empty while no frame has been folded at all.

        The closed blocks and the current partial one are read together, full window or not: WINDOW_BLOCKS is how far
        back the minimum reaches, not a wait the reader serves before anything can be said.
        """
        arrays: list[list[float]] = [record.minimum for record in self._blocks]
        if self._block_min is not None:
            arrays.append([10 * math.log10(p) if p > 0 else -200.0 for p in self._block_min.tolist()])
        if not arrays:
            return []
        return [min(vals) for vals in zip(*arrays, strict=True)]


class MeteringReader:
    """Owns the 4322 connection and the current track's aggregate."""

    def __init__(
        self,
        host: str,
        port: int,
        context: Callable[[], TrackContext | None],
        *,
        pace: Callable[[asyncio.Event, float], Awaitable[bool]],
        advisor: bool,
    ) -> None:
        """Record where the metering port is and how to read track context; nothing connects until ``run``.

        ``pace`` is the manager's clock: it idles the reader for a number of seconds or until the event it is given
        is set. ``advisor`` says whether the junk-filter advisor reads the stream; without it the reader holds the
        socket only while the feed has a subscriber, a subscriber attaching wakes an idle reader at once, and no
        aggregate or verdict is ever kept.
        """
        self._host = host
        self._port = port
        self._context = context
        self._pace = pace
        self._advisor = advisor
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._agg: SpectralAggregate | None = None
        self._holder = junkadvisor.SpurHolder()
        self._verdict: junkadvisor.JunkVerdict | None = None
        self.feed = MeterFeed(on_subscribe=self._wake.set)

    def retarget(self, host: str, port: int) -> None:
        """Point the reader at another daemon; the next dial uses it.

        The address is read at ``open_connection`` time rather than latched at construction, so a connection setting
        the user changed at runtime reaches the metering side channel with the reconnect the manager already forces.
        """
        self._host = host
        self._port = port

    def stop(self) -> None:
        """Ask the reader to shut down: the stream loop, the idle wait and the backoff all end at the next check."""
        self._stop.set()
        self._wake.set()

    def aggregate(self) -> SpectralAggregate | None:
        """Return the aggregate the reader is accumulating, or None while there is no evidence to read."""
        return self._agg

    def verdict(self) -> junkadvisor.JunkVerdict | None:
        """Return the signature the windowed minimum spectrum carried when the last block closed, whatever is engaged.

        The verdict is classified once per closed block, on the reader's own task, and held until the next block
        closes; this returns that held value and touches neither the aggregate nor the spur holder, so every caller,
        on whatever thread, reads the same verdict. None while the engine is unreachable, while no aggregate stands,
        and before the first block of one has closed. The ramp is a property of the spectrum in front of the rules,
        so it appears at the block whose window carries the signature and is gone at the first that does not. The
        spur is held per bin by the reader's ``SpurHolder`` until the tone's excess over the local baseline falls under
        the release split or the bin stops standing clear of the floor, so a loud passage that lifts the baseline over a
        tone no longer drops the advice and brings it back. The holder carries no track identity and neither does the
        aggregate: a held bin releases when the rules stop seeing it, not when the track changes.

        Deliberately blind to the engaged filter, unlike ``recommendation``: auto-pilot engages what the signature
        asks for and has to keep seeing that signature afterwards, or it would lose the very evidence that says the
        filter is still earning its place.
        """
        if self._context() is None or self._agg is None:
            return None
        return self._verdict

    def recommendation(self) -> junkadvisor.JunkVerdict | None:
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
        """Hold the stream only while the engine is playing and something reads it, reconnecting after a backoff.

        The daemon streams unconditionally on bare accept — there is no way to ask it for less, so
        the only way to stop paying for frames nobody ingests is to close the socket. The reader therefore connects
        when the engine reports playing and the advisor or a feed subscriber is there to read, and disconnects when
        either stops, which on a bridged Docker network is the difference between megabytes a second of idle traffic
        and none. The idle wait ends early when a subscriber attaches; the backoff after a break does not.

        A broken stream is not an error: it is logged at debug and the aggregate and verdict are discarded, so a
        verdict is only ever computed over one unbroken run of frames. A *deliberate* disconnect at the idle gate is
        not a break — a pause, or the last subscriber leaving, leaves the evidence standing, and so does a track change.
        """
        while not self._stop.is_set():
            self._wake.clear()
            keep = False
            delay, wake = IDLE_RECHECK, self._wake
            try:
                ctx = self._context()
                if ctx is None:
                    pass  # unreachable daemon: nothing to stream, and no evidence worth keeping
                elif ctx.playing and self._wanted():
                    keep = await self._stream()
                else:
                    keep = True  # paused or unread: keep the aggregate for the resume
            except (OSError, asyncio.IncompleteReadError, ControlError) as exc:
                log.debug("metering stream unavailable: %s", exc)
                # a refused or broken stream, an unparseable poll: a backoff no subscriber cuts short
                delay, wake = RECONNECT_DELAY, self._stop
            if not keep:
                self._verdict = None  # a broken stream ends the track's evidence, the verdict read off it first
                self._agg = None
                self._holder = junkadvisor.SpurHolder()  # and the spur hold that rested on it
            if not self._stop.is_set():
                await self._pace(wake, delay)

    def _wanted(self) -> bool:
        """Whether anything reads the stream: the advisor, or a subscriber to the feed."""
        return self._advisor or self.feed.attached()

    async def _stream(self) -> bool:
        """Ingest frames until the engine stops playing or nothing reads them (True), or the loop is stopped (False).

        The play state is checked on a tick of its own rather than after each frame: a stream that goes quiet must
        still be let go, and blocking in ``readexactly`` until the next frame arrives would hold the socket open for
        as long as the daemon stays silent.
        """
        reader, writer = await asyncio.open_connection(self._host, self._port)
        self.feed.reset()  # a resume never mixes frames from before the pause
        log.info("metering stream connected (%s:%s)", self._host, self._port)
        read: asyncio.Task[tuple[tuple[float, ...], bytes]] | None = None
        try:
            frame = 0
            while not self._stop.is_set():
                ctx = self._context()
                if ctx is None or not ctx.playing or not self._wanted():
                    return ctx is not None  # paused or unread keeps the evidence; unreachable does not
                if read is None:
                    read = asyncio.create_task(_read_frame(reader))
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
        arrived = asyncio.Event()
        read.add_done_callback(lambda _: arrived.set())
        await self._pace(arrived, IDLE_RECHECK)
        return read.done()

    def _ingest(self, header: tuple[float, ...], body: bytes) -> None:
        """Reduce one frame once, fold it into the advisor's aggregate where the advisor is on, and feed the meters."""
        levels = reduce_frame(body, int(header[1]), int(header[2]))
        if self._advisor:
            self._fold(levels, int(header[2]), float(header[4]), float(header[5]))
        self.feed.add(header, levels)

    def _fold(self, levels: npt.NDArray[np.float64], bins: int, bandwidth: float, xform_time: float) -> None:
        """Fold one reduced frame into the aggregate, classifying the window each time the frame closes a block."""
        agg = self._agg
        if agg is None or agg.bins != bins or agg.bandwidth != bandwidth:
            self._verdict = None
            agg = self._agg = SpectralAggregate(bins, bandwidth)
        silent = bool((levels[:, 1] < SILENT_RMS_POWER).all())
        if agg.add(levels[:, 2:].sum(axis=0).tolist(), xform_time, silent=silent):
            self._verdict = self._classify(agg)

    def _classify(self, agg: SpectralAggregate) -> junkadvisor.JunkVerdict | None:
        """Classify the window just closed against the track context in hand, None while there is none."""
        ctx = self._context()
        if ctx is None:
            return None
        return junkadvisor.classify(
            agg.window_min_db(),
            agg.bandwidth,
            samplerate=ctx.samplerate,
            sdm=ctx.sdm,
            holder=self._holder,
            run=agg.junk_run,
        )


async def _read_frame(reader: asyncio.StreamReader) -> tuple[tuple[float, ...], bytes]:
    header = HEADER.unpack(await reader.readexactly(HEADER.size))
    channels, bins = int(header[1]), int(header[2])
    if not (0 < channels <= MAX_CHANNELS and 1 < bins <= MAX_BINS):
        raise ImplausibleMeteringHeaderError(channels=channels, bins=bins)
    return header, await reader.readexactly(channels * (16 + 8 * bins))


async def _discard(read: "asyncio.Task[tuple[tuple[float, ...], bytes]] | None") -> None:
    """Cancel a still-pending frame read and collect whatever it ended with, so nothing is left unretrieved."""
    if read is None:
        return
    read.cancel()
    with contextlib.suppress(asyncio.CancelledError, OSError, asyncio.IncompleteReadError):
        await read
