"""What a `MeterFeed` queues for its subscribers from the frames it is given.

Every case packs its own frames in the 4322 layout (docs/protocol.md section
7): a header of the eight values ``struct.unpack("<4I3fI")`` reads from the
32-byte header (version 1, channels, xformLength 1025, transformBits,
bandwidth, transformTime, gain, reserved 0), and a body of, per channel, four
`f32` levels in dBFS (peakMax, peak, rms, rmsMax) then 1025 reals and 1025
imaginaries, with bin ``k`` at ``k * bandwidth / 1024`` Hz. A channel's power
sits in the bin nearest its tone and at the floor everywhere else.

The feed's items are ``(event, data)`` pairs read off the queue `subscribe()`
hands back, drained after every `add`.
"""

from __future__ import annotations

import asyncio
import inspect
import itertools
import math
import struct
from typing import Any

import pytest

from hqptuner.engine.meterfeed import MeterFeed

HEADER = "<4I3fI"
VERSION = 1
BINS = 1025
TRANSFORM_BITS = 16
GAIN = 2.0
RESERVED = 0

FLOOR_REAL = 1e-3
TONE_REAL = 1.0

#: peakMax, peak, rms, rmsMax in dBFS, where a case does not sweep them.
LEVELS = (-3.0, -6.0, -20.0, -18.0)

#: A ceiling on how many frames a case feeds before giving up on a `frame`
#: item; only a feed that never emits one reaches it.
MAX_ADDS = 1000

Frame = tuple[tuple[Any, ...], bytes]
Item = tuple[str, Any]


def _header(channels: int, bandwidth: float, transform_time: float) -> tuple[Any, ...]:
    packed = struct.pack(HEADER, VERSION, channels, BINS, TRANSFORM_BITS, bandwidth, transform_time, GAIN, RESERVED)
    return struct.unpack(HEADER, packed)


def _tone_bin(tone_hz: float, bandwidth: float) -> int:
    return round(tone_hz / (bandwidth / (BINS - 1)))


def _channel(levels: tuple[float, float, float, float], tone_hz: float, bandwidth: float) -> bytes:
    reals = [FLOOR_REAL] * BINS
    reals[_tone_bin(tone_hz, bandwidth)] = TONE_REAL
    imaginaries = [0.0] * BINS
    return struct.pack(f"<4f{BINS}f{BINS}f", *levels, *reals, *imaginaries)


def _frame(
    channels: list[tuple[tuple[float, float, float, float], float]],
    bandwidth: float,
    transform_time: float,
) -> Frame:
    """One frame: ``channels`` is each channel's (levels, tone_hz)."""
    header = _header(len(channels), bandwidth, transform_time)
    body = b"".join(_channel(levels, tone_hz, bandwidth) for levels, tone_hz in channels)
    return header, body


def _mono(levels: tuple[float, float, float, float], bandwidth: float = 22050.0) -> Frame:
    return _frame([(levels, 3000.0)], bandwidth, 1024 / (2 * bandwidth))


async def _resolved(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _drain(queue: Any) -> list[Item]:
    await asyncio.sleep(0)
    items: list[Item] = []
    while not queue.empty():
        event, data = queue.get_nowait()
        items.append((event, data))
    return items


async def _items(frames: list[Frame], then: Frame | None = None) -> list[Item]:
    """Feed ``frames`` and then ``then`` repeatedly to one fresh feed with one
    subscriber, stopping at the first `frame` item where ``then`` is given;
    every item queued up to and including it."""
    feed = MeterFeed()
    queue = await _resolved(feed.subscribe())
    tail = itertools.repeat(then, MAX_ADDS) if then is not None else iter(())
    items: list[Item] = []
    for header, body in itertools.chain(frames, tail):
        await _resolved(feed.add(header, body))
        items.extend(await _drain(queue))
        if then is not None and any(event == "frame" for event, _ in items):
            break
    return items


def _until_first_frame(items: list[Item]) -> list[Item]:
    for index, (event, _) in enumerate(items):
        if event == "frame":
            return items[: index + 1]
    return items


def _first_frame(items: list[Item]) -> dict[str, Any]:
    for event, data in items:
        if event == "frame":
            return dict(data)
    return {}


def _geometry_before_first_frame(items: list[Item]) -> dict[str, Any]:
    geometry: dict[str, Any] = {}
    for event, data in _until_first_frame(items):
        if event == "geometry":
            geometry = dict(data)
    return geometry


# --- line 1: each channel's tone lights its own bar ------------------------


def _loudest_bars(items: list[Item]) -> tuple[int, int]:
    channels = _first_frame(items)["channels"]
    bands = [list(channels[index]["bands"]) for index in (0, 1)]
    left, right = (max(range(len(values)), key=values.__getitem__) for values in bands)
    return left, right


def _nearest_centres(items: list[Item], tones: tuple[float, float], bandwidth: float) -> tuple[int, int]:
    centres = [float(centre) for centre in _geometry_before_first_frame(items)["centres"]]
    bin_hz = bandwidth / (BINS - 1)

    def nearest(tone_hz: float) -> int:
        frequency = _tone_bin(tone_hz, bandwidth) * bin_hz
        return min(range(len(centres)), key=lambda index: abs(math.log(centres[index] / frequency)))

    return nearest(tones[0]), nearest(tones[1])


@pytest.mark.parametrize("bandwidth", [22050.0, 48000.0], ids=["22.05 kHz", "48 kHz"])
@pytest.mark.parametrize(
    "tones",
    [(3000.0, 12000.0), (12000.0, 3000.0)],
    ids=["3 kHz left, 12 kHz right", "12 kHz left, 3 kHz right"],
)
async def test_each_channels_tone_lights_the_bar_whose_centre_is_nearest_it(
    tones: tuple[float, float], bandwidth: float
) -> None:
    stereo = _frame([(LEVELS, tones[0]), (LEVELS, tones[1])], bandwidth, 1024 / (2 * bandwidth))
    items = await _items([], then=stereo)
    assert _loudest_bars(items) == _nearest_centres(items, tones, bandwidth)


# --- line 2: a frame item holds the stride's peak and a blend of its rms ----


def _levels_read(items: list[Item], rms_low: float, rms_high: float) -> tuple[float, bool]:
    channel = _first_frame(items)["channels"][0]
    return float(channel["peak"]), rms_low < float(channel["rms"]) < rms_high


@pytest.mark.parametrize(
    ("a_peak", "a_rms", "b_peak", "b_rms", "expected"),
    [(-6.0, -20.0, -12.0, -40.0, (-6.0, True)), (-3.0, -10.0, -9.0, -30.0, (-3.0, True))],
    ids=["A -6 over B -12", "A -3 over B -9"],
)
async def test_a_frame_item_holds_the_loudest_peak_and_an_rms_between_the_frames_it_covers(
    a_peak: float, a_rms: float, b_peak: float, b_rms: float, expected: tuple[float, bool]
) -> None:
    first = _mono((a_peak, a_peak, a_rms, a_rms))
    rest = _mono((b_peak, b_peak, b_rms, b_rms))
    items = await _items([first], then=rest)
    assert _levels_read(items, b_rms, a_rms) == expected


# --- line 3: a faster source is thinned harder ------------------------------


async def _frame_items(bandwidth: float) -> int:
    frames = [_mono(LEVELS, bandwidth)] * 8
    return sum(1 for event, _ in await _items(frames) if event == "frame")


async def test_a_96_khz_source_queues_fewer_frame_items_than_a_44_1_khz_one() -> None:
    assert await _frame_items(48000.0) < await _frame_items(22050.0)


# --- line 4: a channel change restarts the stride ---------------------------


def _events(items: list[Item]) -> list[tuple[str, Any]]:
    return [
        (event, data["channels"] if event == "geometry" else data["channels"][0]["peak"])
        for event, data in _until_first_frame(items)
    ]


@pytest.mark.parametrize("peak", [-20.0, -30.0], ids=["P -20", "P -30"])
async def test_a_channel_change_sends_the_new_geometry_before_a_frame_of_only_the_new_shape(
    peak: float,
) -> None:
    loud = (-1.0, -1.0, -20.0, -20.0)
    stereo = _frame([(loud, 3000.0), (loud, 3000.0)], 22050.0, 1024 / 44100)
    mono = _frame([((peak, peak, -40.0, -40.0), 3000.0)], 22050.0, 1024 / 44100)
    items = await _items([stereo], then=mono)
    assert _events(items) == [("geometry", 2), ("geometry", 1), ("frame", peak)]
