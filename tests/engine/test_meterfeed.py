"""What a `MeterFeed` queues for its subscribers from the frames it is given.

Every case packs its own frames in the 4322 layout (docs/protocol.md section
7): a header of the eight values ``struct.unpack("<4I3fI")`` reads from the
32-byte header (version 1, channels, xformLength, transformBits, bandwidth,
transformTime, gain, reserved 0), and a body of, per channel, four `f32`
levels in dBFS (peakMax, peak, rms, rmsMax) then the reals and the
imaginaries, with bin ``k`` at ``k * bandwidth / (xformLength - 1)`` Hz. A
channel's power sits in the bin nearest its tone and at its floor everywhere
else. The transform time is one hop of ``xformLength - 1`` samples at twice
the bandwidth.

A `frame` item carries each channel's bins as standard padded base64 of two
bytes per bin, low byte first, DC first, each bin a count of steps decoding to
``-step * BIN_STEP_DB`` dBFS.

The feed's items are ``(event, data)`` pairs read off the queue `subscribe()`
hands back, drained after every `add`.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import itertools
import math
import struct
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import pytest

from hqptuner.engine.meterfeed import Event, MeterFeed, reduce_frame

if TYPE_CHECKING:
    from collections.abc import Awaitable

HEADER = "<4I3fI"
VERSION = 1
BINS = 1025
TRANSFORM_BITS = 16
GAIN = 2.0
RESERVED = 0

FLOOR_REAL = 1e-3
TONE_REAL = 1.0
TONE_HZ = 3000.0

#: dB per step of a decoded bin.
BIN_STEP_DB = 0.5

#: Nyquist of a 44.1k, a 96k and a 192k source.
NYQUIST_44K = 22050.0
NYQUIST_96K = 48000.0
NYQUIST_192K = 96000.0

#: peakMax, peak, rms, rmsMax in dBFS, where a case does not sweep them.
LEVELS = (-3.0, -6.0, -20.0, -18.0)

#: A ceiling on how many frames a case feeds before giving up on a `frame`
#: item; only a feed that never emits one reaches it.
MAX_ADDS = 1000

Frame = tuple[tuple[Any, ...], bytes]
Item = tuple[str, Any]


@dataclass(frozen=True)
class Channel:
    """One channel of a packed frame: its level block, its tone and the real part of every other bin."""

    levels: tuple[float, float, float, float] = LEVELS
    tone_hz: float = TONE_HZ
    tone_real: float = TONE_REAL
    floor_real: float = FLOOR_REAL


def _header(channels: int, bins: int, bandwidth: float) -> tuple[Any, ...]:
    transform_time = (bins - 1) / (2 * bandwidth)
    packed = struct.pack(HEADER, VERSION, channels, bins, TRANSFORM_BITS, bandwidth, transform_time, GAIN, RESERVED)
    return struct.unpack(HEADER, packed)


def _tone_bin(tone_hz: float, bandwidth: float, bins: int = BINS) -> int:
    return round(tone_hz / (bandwidth / (bins - 1)))


def _channel(channel: Channel, bandwidth: float, bins: int) -> bytes:
    reals = [channel.floor_real] * bins
    reals[_tone_bin(channel.tone_hz, bandwidth, bins)] = channel.tone_real
    imaginaries = [0.0] * bins
    return struct.pack(f"<4f{bins}f{bins}f", *channel.levels, *reals, *imaginaries)


def _frame(channels: list[Channel], bandwidth: float, bins: int = BINS) -> Frame:
    header = _header(len(channels), bins, bandwidth)
    body = b"".join(_channel(channel, bandwidth, bins) for channel in channels)
    return header, body


def _mono(levels: tuple[float, float, float, float], bandwidth: float) -> Frame:
    return _frame([Channel(levels=levels)], bandwidth)


async def _resolved[T](value: T | Awaitable[T]) -> T:
    if inspect.isawaitable(value):
        return await value
    return value


async def _drain(queue: asyncio.Queue[Event]) -> list[Item]:
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
        feed.add(header, reduce_frame(body, int(header[1]), int(header[2])))
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


def _first_geometry(items: list[Item]) -> dict[str, Any]:
    for event, data in items:
        if event == "geometry":
            return dict(data)
    return {}


def _bin_steps(items: list[Item], channel: int) -> list[int]:
    """One channel's bins in the first `frame` item, each as its steps below full scale; empty where it carries none."""
    channels = list(_first_frame(items).get("channels", []))
    text = dict(channels[channel]).get("bins", "") if channel < len(channels) else ""
    raw = base64.b64decode(str(text), validate=True)
    return [low | high << 8 for low, high in zip(raw[::2], raw[1::2], strict=False)]


def _decoded(items: list[Item], channel: int) -> list[float]:
    return [-step * BIN_STEP_DB for step in _bin_steps(items, channel)]


def _loudest_bin(items: list[Item], channel: int) -> int:
    """The index of one channel's loudest decoded bin; -1 where it carries none."""
    decoded = _decoded(items, channel)
    return max(range(len(decoded)), key=decoded.__getitem__, default=-1)


def _bin_db(items: list[Item], channel: int, index: int) -> float:
    """One bin of one channel, decoded to dBFS; NaN where it carries none."""
    decoded = _decoded(items, channel)
    return decoded[index] if index < len(decoded) else math.nan


def _bin_step(items: list[Item], channel: int, index: int) -> int:
    """One bin of one channel as its steps below full scale; -1 where it carries none."""
    steps = _bin_steps(items, channel)
    return steps[index] if index < len(steps) else -1


# --- line 1: frame events run at the refresh rate of the source -------------


#: Nyquist, then the `frame` items twelve frames of 1024 samples queue.
EVENTS = [
    pytest.param(NYQUIST_44K, 12, id="44.1 kHz, one per frame"),
    pytest.param(NYQUIST_96K, 12, id="96 kHz, one per frame"),
    pytest.param(NYQUIST_192K, 4, id="192 kHz, one per three frames"),
]


@pytest.mark.parametrize(("bandwidth", "events"), EVENTS)
async def test_a_source_queues_one_frame_event_per_frame_until_frames_outrun_sixty_a_second(
    bandwidth: float, events: int
) -> None:
    items = await _items([_mono(LEVELS, bandwidth)] * 12)
    assert sum(1 for event, _ in items if event == "frame") == events


# --- line 2: the geometry event states the bins and the Nyquist -------------


@pytest.mark.parametrize("bins", [1025, 513], ids=["1025 bins", "513 bins"])
async def test_the_geometry_event_states_the_bin_count_of_the_frames(bins: int) -> None:
    items = await _items([_frame([Channel()], NYQUIST_44K, bins)])
    assert _first_geometry(items).get("bins") == bins


@pytest.mark.parametrize("bandwidth", [NYQUIST_44K, NYQUIST_192K], ids=["22.05 kHz", "96 kHz"])
async def test_the_geometry_event_states_the_nyquist_of_the_frames(bandwidth: float) -> None:
    items = await _items([_mono(LEVELS, bandwidth)])
    assert _first_geometry(items).get("nyquist") == bandwidth


# --- line 3: each channel's tone decodes loudest in its own bin -------------


@pytest.mark.parametrize("channel", [0, 1], ids=["left", "right"])
@pytest.mark.parametrize("bandwidth", [NYQUIST_44K, NYQUIST_192K], ids=["22.05 kHz", "96 kHz"])
@pytest.mark.parametrize(
    "tones",
    [(3000.0, 12000.0), (12000.0, 3000.0)],
    ids=["3 kHz left, 12 kHz right", "12 kHz left, 3 kHz right"],
)
async def test_each_channels_tone_decodes_loudest_in_its_own_bin(
    tones: tuple[float, float], bandwidth: float, channel: int
) -> None:
    stereo = _frame([Channel(tone_hz=tones[0]), Channel(tone_hz=tones[1])], bandwidth)
    items = await _items([], then=stereo)
    assert _loudest_bin(items, channel) == _tone_bin(tones[channel], bandwidth)


@pytest.mark.parametrize("level", [-12.3, -37.8, -200.0], ids=["-12.3 dB", "-37.8 dB", "-200 dB"])
@pytest.mark.parametrize("bandwidth", [NYQUIST_44K, NYQUIST_192K], ids=["22.05 kHz", "96 kHz"])
async def test_a_tone_decodes_within_half_a_db_of_its_level(bandwidth: float, level: float) -> None:
    mono = _frame([Channel(tone_real=10 ** (level / 20))], bandwidth)
    items = await _items([], then=mono)
    assert _bin_db(items, 0, _tone_bin(TONE_HZ, bandwidth)) == pytest.approx(level, abs=0.5)


@pytest.mark.parametrize("index", [0, BINS - 1], ids=["DC", "Nyquist"])
@pytest.mark.parametrize("bandwidth", [NYQUIST_44K, NYQUIST_192K], ids=["22.05 kHz", "96 kHz"])
async def test_a_silent_bin_travels_as_step_600(bandwidth: float, index: int) -> None:
    mono = _frame([Channel(floor_real=0.0)], bandwidth)
    items = await _items([], then=mono)
    assert _bin_step(items, 0, index) == 600


# --- line 4: a frame item holds the stride's peak and a blend of its rms ----


#: Two frames' (peak, rms) in dBFS: frame A first, then frame B repeated until a frame item is queued.
STRIDES = [
    pytest.param(-6.0, -20.0, -12.0, -40.0, id="A -6 over B -12"),
    pytest.param(-3.0, -10.0, -9.0, -30.0, id="A -3 over B -9"),
]


async def _first_channel(a_peak: float, a_rms: float, b_peak: float, b_rms: float) -> dict[str, Any]:
    """The first channel of the first frame item a 192k source queues for frame A followed by frame B."""
    first = _mono((a_peak, a_peak, a_rms, a_rms), NYQUIST_192K)
    rest = _mono((b_peak, b_peak, b_rms, b_rms), NYQUIST_192K)
    items = await _items([first], then=rest)
    return dict(_first_frame(items)["channels"][0])


@pytest.mark.parametrize(("a_peak", "a_rms", "b_peak", "b_rms"), STRIDES)
async def test_a_frame_item_holds_the_loudest_peak_of_the_frames_it_covers(
    a_peak: float, a_rms: float, b_peak: float, b_rms: float
) -> None:
    channel = await _first_channel(a_peak, a_rms, b_peak, b_rms)
    assert float(channel["peak"]) == a_peak


@pytest.mark.parametrize(("a_peak", "a_rms", "b_peak", "b_rms"), STRIDES)
async def test_a_frame_item_holds_an_rms_between_the_frames_it_covers(
    a_peak: float, a_rms: float, b_peak: float, b_rms: float
) -> None:
    channel = await _first_channel(a_peak, a_rms, b_peak, b_rms)
    assert b_rms < float(channel["rms"]) < a_rms


# --- line 5: a frame item states the frame time it covers -------------------


#: Nyquist, then the frame time one item covers: whole frames of 1024 samples.
COVERS = [
    pytest.param(NYQUIST_44K, 1024 / 44100 * 1000, id="44.1 kHz, one frame"),
    pytest.param(NYQUIST_192K, 3 * 1024 / 192000 * 1000, id="192 kHz, three frames"),
]


@pytest.mark.parametrize(("bandwidth", "ms"), COVERS)
async def test_a_frame_item_states_the_frame_time_of_the_frames_it_covers(bandwidth: float, ms: float) -> None:
    items = await _items([], then=_mono(LEVELS, bandwidth))
    assert _first_frame(items).get("ms") == pytest.approx(ms, abs=1e-3)


# --- line 6: a channel change restarts the stride ---------------------------


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
    stereo = _frame([Channel(levels=loud), Channel(levels=loud)], NYQUIST_192K)
    mono = _mono((peak, peak, -40.0, -40.0), NYQUIST_192K)
    items = await _items([stereo], then=mono)
    assert _events(items) == [("geometry", 2), ("geometry", 1), ("frame", peak)]
