"""The windowed minimum inside a block, and the reader that folds the 4322
stream into it (protocol.md §7).

Two surfaces, both public. `SpectralAggregate` takes linear per-bin powers
through `add` and answers `window_min_db`, so a level of L dB is a power of
``10 ** (L / 10)``. `MeteringReader` runs against the fake stream speaking the
real binary frame layout, and the wire cases drive it through the two seams it
already carries: the track context it reads for itself, and the idle re-check it
waits on between reads.

No case consults a clock. The reader's own idle re-check is what paces a case:
it hands the loop one turn while the wire is still feeding, and parks the reader
for good once the evidence has stopped moving, so every reading is taken with
the reader standing still. Quiescence — a run of idle re-checks over which the
reader's own frame count does not change — is what says the batch is in, and it
says so whatever the reader does with the frames, which is what the cases are
about."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from typing import Any

import pytest
from conftest import PLAYING
from fake_metering import frame
from junk_spectra import FAKE_HIRES_FRAME, spur_min_176

from hqptuner.engine.metering import MeteringReader, SpectralAggregate, TrackContext

# --- SpectralAggregate: inside one block ------------------------------------

AGG_BINS = 8
CONSTANT_BIN = 2
VARYING_BIN = 5


def _agg_frame(varying: float) -> list[float]:
    """Linear powers: the constant bin high, the varying bin as given, every
    other bin on the floor."""
    mags = [10**-12.0] * AGG_BINS
    mags[CONSTANT_BIN] = 10**-2.0
    mags[VARYING_BIN] = varying
    return mags


FRAME_A = _agg_frame(10**-2.0)
FRAME_B = _agg_frame(10**-9.0)


@pytest.mark.parametrize(("index", "expected"), [(CONSTANT_BIN, -20.0), (VARYING_BIN, -90.0)])
def test_two_frames_inside_one_block_report_the_lower_power(index: int, expected: float) -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    aggregate.add(FRAME_A, 2.5)
    aggregate.add(FRAME_B, 2.5)
    for _ in range(5):
        aggregate.add(FRAME_A, 5.0)
    assert (aggregate.window_min_db() or [])[index] == pytest.approx(expected, abs=0.01)


def test_the_block_in_progress_tightens_the_window_minimum() -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(6):
        aggregate.add(FRAME_A, 5.0)
    earned = (aggregate.window_min_db() or [])[VARYING_BIN]
    aggregate.add(FRAME_B, 2.5)
    assert (earned, (aggregate.window_min_db() or [])[VARYING_BIN]) == pytest.approx((-20.0, -90.0), abs=0.01)


# --- driving the reader through its own seams -------------------------------

#: Idle re-checks over which the reader's frame count must hold still before a
#: batch counts as in. Turns of the event loop, never seconds.
QUIET_TURNS = 1000

PAUSED = replace(PLAYING, playing=False)
SECOND_TRACK = replace(PLAYING, track_serial="track-2")
PLAYING_176 = replace(PLAYING, samplerate=176400)


def _frames(reader: MeteringReader) -> int | None:
    """The hops in the track's evidence, or None where the reader holds none."""
    aggregate = reader.aggregate()
    return None if aggregate is None else int(aggregate.frames)


def _window(reader: MeteringReader) -> list[float]:
    """The windowed per-bin minimum the reader has folded, in dB."""
    aggregate = reader.aggregate()
    return [] if aggregate is None else list(aggregate.window_min_db() or [])


class Director:
    """The track context the reader reads for itself.

    Two answers change, both on the reader's own published progress rather than
    on a clock. ``switch`` hands over a second context once the evidence has
    reached the given number of hops, which is how a case moves the engine while
    frames are still arriving; ``terminal`` is handed over once the evidence has
    stopped moving for `QUIET_TURNS` re-checks, which is how a case says the
    batch is in."""

    def __init__(
        self,
        playing: TrackContext,
        terminal: TrackContext | None,
        switch: tuple[int, TrackContext] | None = None,
    ) -> None:
        self._current: TrackContext | None = playing
        self._terminal = terminal
        self._switch = switch
        self._watched: MeteringReader | None = None
        self._last: int | None = None
        self._seen = False
        self._still = 0
        self.finished = False

    def watch(self, reader: MeteringReader) -> None:
        self._watched = reader

    def _advance(self, frames: int | None) -> None:
        if self._switch is not None and frames is not None and frames >= self._switch[0]:
            self._current = self._switch[1]
            self._switch = None
            self._seen = False
            self._still = 0
            return
        if frames != self._last:
            self._last = frames
            self._still = 0
            self._seen = self._seen or frames is not None
            return
        self._still += 1
        if self._seen and self._still >= QUIET_TURNS:
            self._current = self._terminal
            self.finished = True

    def __call__(self) -> TrackContext | None:
        if self._watched is not None and not self.finished:
            self._advance(_frames(self._watched))
        return self._current


async def _turn() -> None:
    """One turn of the event loop, taken without consulting a clock."""
    event = asyncio.Event()
    asyncio.get_running_loop().call_soon(event.set)
    await event.wait()


class Park:
    """The reader's idle re-check.

    While the wire is still feeding it costs one turn of the loop. Once the
    director has handed over its terminal context the reader is parked for good
    and the turn goes back to the test, so the reading is taken off a reader
    that is not moving."""

    def __init__(self, director: Director) -> None:
        self._director = director
        self.reached = asyncio.Event()
        self._held = asyncio.Event()

    async def __call__(self, _seconds: float) -> None:
        if not self._director.finished:
            await _turn()
            return
        self.reached.set()
        await self._held.wait()


@contextlib.asynccontextmanager
async def _reader(port: int, director: Director) -> AsyncIterator[tuple[MeteringReader, Park]]:
    """A reader running against the fake stream, stopped and awaited on exit."""
    park = Park(director)
    reader = MeteringReader("127.0.0.1", port, director, sleep=park)
    director.watch(reader)
    task = asyncio.create_task(reader.run())
    try:
        yield reader, park
    finally:
        reader.stop()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


# --- the reader: what reaches the aggregate ---------------------------------

#: The 176.4 kHz container carrying one persistent 60 kHz tone, 1.25 s apiece.
SPUR_176 = frame(spur_min_176(60000.0), 88200.0, 1.25, channels=2)

#: The same container with nothing in it, its level block below the silence
#: threshold (fake_metering.frame's ``rms``, protocol.md §7).
SILENT_176 = frame([-140.0] * 1025, 88200.0, 1.25, channels=2, rms=-100.0)

#: A frame whose header declares no channels at all.
NO_CHANNELS_176 = frame(spur_min_176(60000.0), 88200.0, 1.25, channels=0)

#: The bin carrying the 60 kHz tone, and one well below it, at 88200/1024 Hz
#: per bin: 60034.57 Hz and 9991.41 Hz.
TONE_BIN = 697
MUSIC_BIN = 116


@pytest.mark.parametrize(("copies", "hops"), [(4, 1), (8, 2), (12, 3)])
async def test_one_frame_in_every_four_reaches_the_aggregate(
    metering_stream: Callable[..., Any], copies: int, hops: int
) -> None:
    stream, port = await metering_stream()
    stream.send(FAKE_HIRES_FRAME, count=copies)
    async with _reader(port, Director(PLAYING, PAUSED)) as (reader, park):
        await park.reached.wait()
        assert _frames(reader) == hops


@pytest.mark.parametrize(("index", "expected"), [(TONE_BIN, -41.99), (MUSIC_BIN, -76.94)])
async def test_frames_below_the_silence_threshold_stay_out_of_the_window_minimum(
    metering_stream: Callable[..., Any], index: int, expected: float
) -> None:
    stream, port = await metering_stream()
    stream.send(SPUR_176, count=24)
    stream.send(SILENT_176, count=24)
    async with _reader(port, Director(PLAYING_176, replace(PLAYING_176, playing=False))) as (reader, park):
        await park.reached.wait()
        assert _window(reader)[index] == pytest.approx(expected, abs=0.01)


@pytest.mark.parametrize(("tail", "hops"), [([], 3), ([NO_CHANNELS_176], None)])
async def test_a_frame_declaring_no_channels_ends_the_tracks_evidence(
    metering_stream: Callable[..., Any], tail: list[bytes], hops: int | None
) -> None:
    stream, port = await metering_stream()
    stream.send(SPUR_176, count=12)
    for payload in tail:
        stream.send(payload)
    async with _reader(port, Director(PLAYING_176, replace(PLAYING_176, playing=False))) as (reader, park):
        await park.reached.wait()
        assert _frames(reader) == hops


@pytest.mark.parametrize(("terminal", "hops"), [(PAUSED, 2), (None, None)])
async def test_a_pause_keeps_the_evidence_an_unreadable_context_ends(
    metering_stream: Callable[..., Any], terminal: TrackContext | None, hops: int | None
) -> None:
    stream, port = await metering_stream()
    stream.send(FAKE_HIRES_FRAME, count=8)
    async with _reader(port, Director(PLAYING, terminal)) as (reader, park):
        await park.reached.wait()
        assert _frames(reader) == hops


@pytest.mark.parametrize(
    ("switch", "hops"),
    [(None, 4), ((2, SECOND_TRACK), 2)],
)
async def test_a_track_change_starts_fresh_evidence(
    metering_stream: Callable[..., Any], switch: tuple[int, TrackContext] | None, hops: int
) -> None:
    stream, port = await metering_stream()
    stream.send(FAKE_HIRES_FRAME, count=16)
    terminal = replace(PLAYING if switch is None else switch[1], playing=False)
    async with _reader(port, Director(PLAYING, terminal, switch)) as (reader, park):
        await park.reached.wait()
        assert _frames(reader) == hops


# --- the reader: the verdict and the note read off the window ---------------


@pytest.mark.parametrize(
    ("terminal", "ceiling"),
    [
        (replace(PLAYING_176, playing=False), 59.9),
        (replace(PLAYING_176, playing=False, track_serial="track-2"), None),
    ],
)
async def test_the_signature_names_the_tone_for_the_current_track_alone(
    metering_stream: Callable[..., Any], terminal: TrackContext, ceiling: float | None
) -> None:
    stream, port = await metering_stream()
    stream.send(SPUR_176, count=24)
    async with _reader(port, Director(PLAYING_176, terminal)) as (reader, park):
        await park.reached.wait()
        assert (reader.verdict() or {}).get("ceiling_khz") == ceiling


@pytest.mark.parametrize(("engaged", "note"), [(None, "40k"), ("40k", None)])
async def test_the_note_goes_quiet_while_the_engaged_filter_treats_the_tone(
    metering_stream: Callable[..., Any], engaged: str | None, note: str | None
) -> None:
    stream, port = await metering_stream()
    stream.send(SPUR_176, count=24)
    playing = replace(PLAYING_176, junk_filter=engaged)
    async with _reader(port, Director(playing, replace(playing, playing=False))) as (reader, park):
        await park.reached.wait()
        assert (reader.recommendation() or {}).get("filter") == note
