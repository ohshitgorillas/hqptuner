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
"""

import asyncio
import contextlib
import logging
import math
import struct
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from . import junkadvisor

if TYPE_CHECKING:
    from .manager import ConnectionManager

log = logging.getLogger(__name__)

HEADER = struct.Struct("<4I3fI")  # version, channels, bins, bits, bandwidth, xformTime, gain, reserved
PLAYING = 2
RECONNECT_DELAY = 5.0
# Ingest every Nth frame (~43/s at 44.1k). The aggregate is a long-run average;
# a quarter of the hops carries the same verdict at a quarter of the CPU.
DECIMATE = 4
MAX_CHANNELS = 32
MAX_BINS = 65_536


@dataclass(frozen=True)
class TrackContext:
    """What the advisor needs to know about the engine's current track."""

    playing: bool
    track_serial: str | None
    samplerate: int | None
    sdm: bool
    junk_filter: str | None


def context_from(manager: "ConnectionManager") -> TrackContext | None:
    """The reader's view of the manager's last poll — None while unreachable."""
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
    )


def _junk_filter_name(status: dict[str, str], enums: dict[str, list[dict[str, str]]] | None) -> str | None:
    """``Status.filter_junk`` joined against the running enumeration — the
    engine is the sole authority for index→name (architecture §2)."""
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
    """Per-track mean power spectrum: per-bin power sums over ingested frames."""

    def __init__(self, bins: int, bandwidth: float) -> None:
        self.bins = bins
        self.bandwidth = bandwidth
        self.frames = 0
        self.seconds = 0.0
        self._power = [0.0] * bins

    def add(self, mags_sq: list[float], covered_seconds: float) -> None:
        for i, p in enumerate(mags_sq):
            self._power[i] += p
        self.frames += 1
        self.seconds += covered_seconds

    def levels_db(self) -> list[float]:
        return [10 * math.log10(p / self.frames) if p > 0 else -200.0 for p in self._power]


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
        self._host = host
        self._port = port
        self._context = context
        self._sleep = sleep
        self._stop = asyncio.Event()
        self._agg: SpectralAggregate | None = None
        self._serial: str | None = None

    def stop(self) -> None:
        self._stop.set()

    def recommendation(self) -> dict[str, Any] | None:
        """The advisor's verdict for the current aggregate, or None. Computed on
        demand — the status route calls this once per poll."""
        ctx, agg = self._context(), self._agg
        if ctx is None or agg is None or agg.frames == 0:
            return None
        return junkadvisor.classify(
            agg.levels_db(),
            agg.bandwidth,
            agg.seconds,
            samplerate=ctx.samplerate,
            sdm=ctx.sdm,
            junk_filter=ctx.junk_filter,
        )

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                await self._stream()
            except (OSError, asyncio.IncompleteReadError) as exc:
                log.debug("metering stream unavailable: %s", exc)
            self._agg = None  # a broken stream ends the track's evidence
            if not self._stop.is_set():
                await self._backoff()

    async def _backoff(self) -> None:
        if self._sleep is not None:  # test seam — virtualized clock
            await self._sleep(RECONNECT_DELAY)
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stop.wait(), RECONNECT_DELAY)

    async def _stream(self) -> None:
        reader, writer = await asyncio.open_connection(self._host, self._port)
        log.info("metering stream connected (%s:%s)", self._host, self._port)
        try:
            frame = 0
            while not self._stop.is_set():
                header, body = await self._read_frame(reader)
                frame += 1
                if frame % DECIMATE == 0:
                    self._ingest(header, body)
        finally:
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()

    async def _read_frame(self, reader: asyncio.StreamReader) -> tuple[tuple[float, ...], bytes]:
        header = HEADER.unpack(await reader.readexactly(HEADER.size))
        channels, bins = int(header[1]), int(header[2])
        if not (0 < channels <= MAX_CHANNELS and 1 < bins <= MAX_BINS):
            raise OSError(f"implausible metering header (channels={channels}, bins={bins})")
        return header, await reader.readexactly(channels * (16 + 8 * bins))

    def _ingest(self, header: tuple[float, ...], body: bytes) -> None:
        ctx = self._context()
        if ctx is None:
            self._agg = None
            return
        if not ctx.playing:
            return  # keep the aggregate across a pause; idle frames carry no music
        channels, bins = int(header[1]), int(header[2])
        bandwidth, xform_time = float(header[4]), float(header[5])
        agg = self._agg
        if agg is None or ctx.track_serial != self._serial or agg.bins != bins or agg.bandwidth != bandwidth:
            agg = self._agg = SpectralAggregate(bins, bandwidth)
            self._serial = ctx.track_serial
        agg.add(_frame_power(body, channels, bins), xform_time * DECIMATE)


def _frame_power(body: bytes, channels: int, bins: int) -> list[float]:
    """Channel-summed squared magnitudes. The transform block is two consecutive
    halves (reals then imaginaries, not interleaved) — protocol.md §7."""
    power = [0.0] * bins
    stride = 16 + 8 * bins
    for ch in range(channels):
        vals = struct.unpack_from(f"<{2 * bins}f", body, ch * stride + 16)
        for k in range(bins):
            power[k] += vals[k] ** 2 + vals[bins + k] ** 2
    return power
