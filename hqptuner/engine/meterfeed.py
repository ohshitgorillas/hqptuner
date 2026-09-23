"""The METER page's feed: metering frames reduced to per-channel levels and a 1/12-octave spectrum, one event per stride.

Frames arrive at the transform hop rate (~43/s at 44.1k, 187/s at 192k). The feed folds a stride of them into one
``frame`` event, so a page redraws at 20 to 30 events a second whatever the source rate: the stride is the number of
frames covering 40 ms of the frame time the header declares. Across a stride the peak is max-held and the rms and the
band spectrum are power-averaged.

A ``geometry`` event, carrying what a page needs to lay the bars out, always goes ahead of the first ``frame`` it
describes. A geometry change mid-stride drops the partial stride rather than mixing two geometries in one event.

Nothing is reduced while no subscriber is attached. Each subscriber holds a bounded queue that drops its oldest event
on overflow, so a stalled client never back-pressures the reader.
"""

import asyncio
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from hqptuner.engine.bands import BAND_FLOOR_DB

#: one queued event: its name and its JSON-ready data
Event = tuple[str, dict[str, Any]]

# Frame time one ``frame`` event covers, in milliseconds.
STRIDE_MS = 40
# Events a subscriber's queue holds before its oldest is dropped.
QUEUE_DEPTH = 8
# The spectrum's lowest band is the first whose centre sits above this.
LOWEST_CENTRE_HZ = 20.0
# Bands per octave, centred on 1 kHz.
BANDS_PER_OCTAVE = 12
# Per-channel level block ahead of the transform values: peakMax, peak, rms, rmsMax.
LEVELS = 4


@dataclass(frozen=True)
class Geometry:
    """What one frame layout reduces to: its channel count, bin count, Nyquist and the band table over its bins."""

    channels: int
    bins: int
    bandwidth: float
    centres: list[float]
    lo: npt.NDArray[np.intp]
    hi: npt.NDArray[np.intp]

    def event(self) -> Event:
        """Return the ``geometry`` event a page lays its bars out from."""
        return (
            "geometry",
            {"nyquist": self.bandwidth, "channels": self.channels, "centres": [round(c, 1) for c in self.centres]},
        )


def geometry(channels: int, bins: int, bandwidth: float) -> Geometry:
    """Build the band table for one frame layout.

    Centres run at 1000·2^(k/12) Hz from the first above ``LOWEST_CENTRE_HZ`` to the last whose lower edge sits below
    Nyquist. A band spans the bins from its lower edge up to its upper edge; a band holding no bin takes the nearest
    one, so the low bands of a coarse transform share one bin's value rather than interpolating between bins.
    """
    per_bin = bandwidth / (bins - 1)
    half = 2 ** (1 / (2 * BANDS_PER_OCTAVE))
    first = math.floor(BANDS_PER_OCTAVE * math.log2(LOWEST_CENTRE_HZ / 1000)) + 1
    last = math.ceil(BANDS_PER_OCTAVE * math.log2(bandwidth * half / 1000)) - 1
    centres = [1000 * 2 ** (k / BANDS_PER_OCTAVE) for k in range(first, last + 1)]
    lo, hi = [], []
    for centre in centres:
        start = min(bins, math.ceil(centre / half / per_bin))
        end = min(bins, math.ceil(centre * half / per_bin))
        if end <= start:
            start = min(bins - 1, round(centre / per_bin))
            end = start + 1
        lo.append(start)
        hi.append(end)
    return Geometry(channels, bins, bandwidth, centres, np.array(lo, dtype=np.intp), np.array(hi, dtype=np.intp))


def stride(bins: int, xform_time: float) -> int:
    """Frames per ``STRIDE_MS`` of frame time, nearest with ties rounding up, at least 1.

    Counted from the source rate the header implies (a hop of ``bins - 1`` samples per ``xform_time``), rounded to
    whole hertz, so the ``f32`` frame time cannot tip a tie such as 7.5 frames at 192k either way.
    """
    hop = bins - 1
    rate = round(hop / xform_time)
    return max(1, (2 * STRIDE_MS * rate + 1000 * hop) // (2000 * hop))


def reduce_frame(body: bytes, channels: int, bins: int, geo: Geometry) -> npt.NDArray[np.float64]:
    """One frame's per-channel linear levels: column 0 the peak in dB, column 1 the rms power, then the band powers.

    The transform block is two consecutive halves, reals then imaginaries (protocol.md §7). A band's power is the mean
    power of the bins the band table gives it.
    """
    block = np.frombuffer(body, dtype="<f4", count=channels * (LEVELS + 2 * bins)).reshape(channels, LEVELS + 2 * bins)
    re = block[:, LEVELS : LEVELS + bins].astype(np.float64)
    im = block[:, LEVELS + bins :].astype(np.float64)
    cumulative = np.concatenate([np.zeros((channels, 1)), np.cumsum(re * re + im * im, axis=1)], axis=1)
    bands = (cumulative[:, geo.hi] - cumulative[:, geo.lo]) / (geo.hi - geo.lo)
    peak = block[:, 1].astype(np.float64)
    rms = np.power(10.0, block[:, 2].astype(np.float64) / 10)
    return np.column_stack([peak, rms, bands])


def _db(power: npt.NDArray[np.float64]) -> list[float]:
    """Linear power to dB at 0.1 dB, floored at ``BAND_FLOOR_DB`` where the power is zero."""
    with np.errstate(divide="ignore"):
        levels = np.maximum(BAND_FLOOR_DB, 10 * np.log10(power))
    return [round(float(v), 1) for v in levels]


def _frame_event(peak: npt.NDArray[np.float64], mean: npt.NDArray[np.float64]) -> Event:
    """A finished stride as a ``frame`` event: the max-held peak, and the mean rms and band powers, all in dB."""
    channels = [
        {"peak": round(float(peak[ch]), 1), "rms": _db(mean[ch, :1])[0], "bands": _db(mean[ch, 1:])}
        for ch in range(len(peak))
    ]
    return ("frame", {"channels": channels})


class MeterFeed:
    """Stride accumulator and subscriber set for the METER page's event stream."""

    def __init__(self) -> None:
        """Start with no geometry, no stride in hand and no subscriber."""
        self._subscribers: list[asyncio.Queue[Event]] = []
        self._geo: Geometry | None = None
        self._stride = 1
        self._count = 0
        self._peak: npt.NDArray[np.float64] | None = None
        self._power: npt.NDArray[np.float64] | None = None

    def subscribe(self) -> "asyncio.Queue[Event]":
        """Attach a subscriber; its queue receives the held geometry at once, where there is one."""
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_DEPTH)
        self._subscribers.append(queue)
        if self._geo is not None:
            queue.put_nowait(self._geo.event())
        return queue

    def unsubscribe(self, queue: "asyncio.Queue[Event]") -> None:
        """Detach a subscriber; the last one leaving drops the partial stride, since nothing reduced it for anyone."""
        if queue in self._subscribers:
            self._subscribers.remove(queue)
        if not self._subscribers:
            self._restart()

    def reset(self) -> None:
        """Forget the geometry and the partial stride; the next frame's geometry goes out ahead of its stride."""
        self._geo = None
        self._restart()

    def add(self, header: tuple[float, ...], body: bytes) -> None:
        """Fold one frame into the stride, and send a ``frame`` event once the stride is complete."""
        if not self._subscribers:
            return
        channels, bins, bandwidth = int(header[1]), int(header[2]), float(header[4])
        geo = self._geo
        if geo is None or (geo.channels, geo.bins, geo.bandwidth) != (channels, bins, bandwidth):
            geo = self._geo = geometry(channels, bins, bandwidth)
            self._restart()
            self._send(geo.event())
        self._stride = stride(bins, float(header[5]))
        levels = reduce_frame(body, channels, bins, geo)
        peak, power = levels[:, 0], levels[:, 1:]
        if self._peak is not None and self._power is not None:
            peak, power = np.maximum(self._peak, peak), self._power + power
        self._peak, self._power = peak, power
        self._count += 1
        if self._count >= self._stride:
            self._send(_frame_event(peak, power / self._count))
            self._restart()
    def _send(self, event: Event) -> None:
        """Queue one event for every subscriber, dropping a subscriber's oldest event where its queue is full."""
        for queue in self._subscribers:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

    def _restart(self) -> None:
        self._count = 0
        self._peak = None
        self._power = None
