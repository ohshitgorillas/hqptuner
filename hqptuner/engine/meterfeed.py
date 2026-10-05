"""The meters' feed: metering frames reduced to per-channel levels and the transform's own bins per stride.

Frames arrive at the transform hop rate (~43/s at 44.1k, 187/s at 192k). A screen shows at most one picture per
refresh, so the feed sends every frame until frames outrun ``REFRESH_HZ`` and folds the fewest whole frames that bring
it back under: the stride. Across a stride the peak is max-held and the rms and each bin's power are power-averaged, so
folding loses nothing a meter shows. Each bin travels as one byte, ``BIN_STEP_DB`` per step below full scale.

A ``geometry`` event, carrying what a page needs to lay the bars out, always goes ahead of the first ``frame`` it
describes. A geometry change mid-stride drops the partial stride rather than mixing two geometries in one event.

Nothing is reduced while no subscriber is attached. Each subscriber holds a bounded queue that drops its oldest event
on overflow, so a stalled client never back-pressures the reader.
"""

import asyncio
import base64
from dataclasses import dataclass
from typing import NamedTuple, TypedDict

import numpy as np
import numpy.typing as npt


class ChannelLevels(TypedDict):
    """One channel's share of a ``frame`` event: its max-held peak and mean rms in dB, and its bins as base64 bytes."""

    peak: float
    rms: float
    bins: str


class GeometryData(TypedDict):
    """A ``geometry`` event's payload: what a page needs to lay its bars out for one frame layout."""

    nyquist: float
    channels: int
    bins: int


class FrameData(TypedDict):
    """A ``frame`` event's payload: one finished stride, per channel, and the frame time it covers in milliseconds."""

    channels: list[ChannelLevels]
    ms: float


#: The two shapes ``MeterFeed`` ever queues, told apart by ``Event.name`` ("geometry" or "frame").
type EventData = GeometryData | FrameData


class Event(NamedTuple):
    """One queued event: its name and its JSON-ready data."""

    name: str
    data: EventData


# The display refresh rate the stride folds frames down to.
REFRESH_HZ = 60
# One bin byte's step below full scale, dB: 255 steps reach the widest Range and a little past it.
BIN_STEP_DB = 0.5
BIN_MAX = 255
# Events a subscriber's queue holds before its oldest is dropped.
QUEUE_DEPTH = 8
# Per-channel level block ahead of the transform values: peakMax, peak, rms, rmsMax.
LEVELS = 4
# Where a zero rms power lands, in dB: a 64-bit stream attenuated upstream carries real content far below what a
# 24-bit one can.
FEED_FLOOR_DB = -300.0


@dataclass(frozen=True)
class Geometry:
    """One frame layout: its channel count, bin count and Nyquist."""

    channels: int
    bins: int
    bandwidth: float

    def event(self) -> Event:
        """Return the ``geometry`` event a page lays its bars and axes out from."""
        data: GeometryData = {"nyquist": self.bandwidth, "channels": self.channels, "bins": self.bins}
        return Event("geometry", data)


def stride(bins: int, xform_time: float) -> int:
    """Whole frames per event: each frame alone up to ``REFRESH_HZ`` frames a second, else the most that fit a refresh.

    Counted from the source rate the header implies (a hop of ``bins - 1`` samples per ``xform_time``), rounded to
    whole hertz, so the ``f32`` frame time cannot tip a boundary either way.
    """
    hop = bins - 1
    rate = round(hop / xform_time)
    return max(1, rate // (REFRESH_HZ * hop))


def reduce_frame(body: bytes, channels: int, bins: int) -> npt.NDArray[np.float64]:
    """One frame's per-channel linear levels: column 0 the peak in dB, column 1 the rms power, then each bin's power.

    The transform block is two consecutive halves, reals then imaginaries (protocol.md §7).
    """
    block = np.frombuffer(body, dtype="<f4", count=channels * (LEVELS + 2 * bins)).reshape(channels, LEVELS + 2 * bins)
    re = block[:, LEVELS : LEVELS + bins].astype(np.float64)
    im = block[:, LEVELS + bins :].astype(np.float64)
    peak = block[:, 1].astype(np.float64)
    rms = np.power(10.0, block[:, 2].astype(np.float64) / 10)
    return np.column_stack([peak, rms, re * re + im * im])


def _db(power: npt.NDArray[np.float64]) -> list[float]:
    """Linear power to dB at 0.1 dB, floored at ``FEED_FLOOR_DB``."""
    with np.errstate(divide="ignore"):
        levels = np.maximum(FEED_FLOOR_DB, 10 * np.log10(power))
    return [round(float(v), 1) for v in levels]


def _bin_bytes(power: npt.NDArray[np.float64]) -> str:
    """Bin powers as base64 bytes, each ``BIN_STEP_DB`` per step below full scale; a zero power is the last step."""
    with np.errstate(divide="ignore"):
        steps = np.rint(-10 * np.log10(power) / BIN_STEP_DB)
    return base64.b64encode(np.clip(steps, 0, BIN_MAX).astype(np.uint8).tobytes()).decode("ascii")


def _frame_event(peak: npt.NDArray[np.float64], mean: npt.NDArray[np.float64], ms: float) -> Event:
    """Return a finished stride as a ``frame`` event: peak and rms in dB, bins as bytes, and its frame time in ms."""
    channels: list[ChannelLevels] = [
        {"peak": round(float(peak[ch]), 1), "rms": _db(mean[ch, :1])[0], "bins": _bin_bytes(mean[ch, 1:])}
        for ch in range(len(peak))
    ]
    data: FrameData = {"channels": channels, "ms": round(ms, 3)}
    return Event("frame", data)


class MeterFeed:
    """Stride accumulator and subscriber set for the meters' event stream."""

    def __init__(self) -> None:
        """Start with no geometry, no stride in hand and no subscriber."""
        self._subscribers: list[asyncio.Queue[Event]] = []
        self._geo: Geometry | None = None
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
            geo = self._geo = Geometry(channels, bins, bandwidth)
            self._restart()
            self._send(geo.event())
        levels = reduce_frame(body, channels, bins)
        peak, power = levels[:, 0], levels[:, 1:]
        if self._peak is not None and self._power is not None:
            peak, power = np.maximum(self._peak, peak), self._power + power
        self._peak, self._power = peak, power
        self._count += 1
        xform_time = float(header[5])
        if self._count >= stride(bins, xform_time):
            self._send(_frame_event(peak, power / self._count, self._count * xform_time * 1000))
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
