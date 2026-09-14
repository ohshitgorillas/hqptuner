"""Spur persistence: the windowed per-bin minimum spectrum and the verdict read
off it.

`SpectralAggregate` cases feed linear per-bin powers straight into the public
`add` and read the contract back through `window_min_db` — a level of L dB is a
power of ``10 ** (L / 10)``. The reader cases run against the fake 4322 stream
speaking the real binary frame layout (protocol.md §7), on the shared spectrum
builders (`junk_spectra`) and running-reader harness (`conftest`).

Silence (spec behavior 12/17) is covered both ways: the aggregate-level cases
exercise ``silent=True`` directly, and one wire case streams frames whose level
blocks carry RMS below -90 dBFS (`fake_metering.frame`'s ``rms``)."""

import asyncio
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pytest
from conftest import PLAYING, eventually, running_reader
from fake_metering import MeteringStream, frame
from junk_spectra import BINS as WIRE_BINS
from junk_spectra import FAKE_HIRES_FRAME, cutoff_96k, flat_fullband_96k, spur_min_176

from hqptuner.engine.metering import DECIMATE, SpectralAggregate, TrackContext

# --- SpectralAggregate: the windowed minimum -------------------------------------

AGG_BINS = 8
_CONSTANT_BIN = 2  # fed the same power in every non-silent frame
_VARYING_BIN = 5  # fed high power in some frames, low in others


def _power(level_db: float) -> float:
    return float(10 ** (level_db / 10))


def _agg_frame(varying_db: float) -> list[float]:
    mags = [_power(-120.0)] * AGG_BINS
    mags[_CONSTANT_BIN] = _power(-20.0)
    mags[_VARYING_BIN] = _power(varying_db)
    return mags


HIGH_FRAME = _agg_frame(-20.0)
LOW_FRAME = _agg_frame(-90.0)
SILENT_FRAME = [_power(-120.0)] * AGG_BINS  # all-floor: what a silent hop carries


def _bin_reading(aggregate: SpectralAggregate, bin_index: int) -> float | None:
    """One bin of the windowed minimum in whole dB, or None while the window is
    unearned. Rounding stands in for the tolerance an approx comparison would
    carry, so a reading and a bare None can be compared side by side."""
    curve = aggregate.window_min_db()
    return None if curve is None else round(curve[bin_index], 1)


@pytest.mark.parametrize(
    ("hops", "coverage", "expected"),
    [
        (4, 0.05, None),
        (20, 0.04, None),
        (4, 0.24, None),
        (2, 0.5, -20.0),
        (4, 0.25, -20.0),
    ],
)
def test_the_window_is_earned_by_summed_coverage_not_by_hop_count(
    hops: int, coverage: float, expected: float | None
) -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(hops):
        aggregate.add(HIGH_FRAME, coverage)
    assert _bin_reading(aggregate, _CONSTANT_BIN) == expected


def test_the_window_drops_the_oldest_hop_as_newer_hops_arrive() -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for mags in (LOW_FRAME, LOW_FRAME, HIGH_FRAME):
        aggregate.add(mags, 0.5)
    with_the_low_hop_in_the_window = _bin_reading(aggregate, _VARYING_BIN)
    aggregate.add(HIGH_FRAME, 0.5)  # the second low hop ages out of the window
    assert (with_the_low_hop_in_the_window, _bin_reading(aggregate, _VARYING_BIN)) == (-90.0, -20.0)


def _earned_alternating() -> SpectralAggregate:
    """High and low frames alternating, half a second of coverage apiece, well
    past the persistence window."""
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    for _ in range(4):
        aggregate.add(HIGH_FRAME, 0.5)
        aggregate.add(LOW_FRAME, 0.5)
    return aggregate


def test_a_bin_fed_the_same_power_reports_that_level() -> None:
    assert (_earned_alternating().window_min_db() or [])[_CONSTANT_BIN] == pytest.approx(-20.0, abs=0.5)


# --- SpectralAggregate: silent frames ---------------------------------------------


def _tone_plus_silence() -> SpectralAggregate:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    aggregate.add(HIGH_FRAME, 5.0)
    aggregate.add(SILENT_FRAME, 5.0, silent=True)
    return aggregate


def test_silent_frames_count_toward_frames() -> None:
    assert _tone_plus_silence().frames == 2


def test_silent_frames_count_toward_seconds() -> None:
    assert _tone_plus_silence().seconds == pytest.approx(10.0)


def test_silent_hops_buy_the_window_no_coverage() -> None:
    aggregate = SpectralAggregate(AGG_BINS, 48000.0)
    aggregate.add(LOW_FRAME, 0.5)
    aggregate.add(SILENT_FRAME, 0.5, silent=True)
    aggregate.add(SILENT_FRAME, 0.5, silent=True)
    on_half_a_second_of_tone = _bin_reading(aggregate, _VARYING_BIN)
    aggregate.add(HIGH_FRAME, 0.5)  # the second tone hop earns the window
    assert (on_half_a_second_of_tone, _bin_reading(aggregate, _VARYING_BIN)) == (None, -90.0)


# --- MeteringReader: the verdict on the wire --------------------------------------

#: Strong flat content across the whole 0-48 kHz band, 0.7 s per frame: content
#: clear to Nyquist, so a window made of these frames carries no ceiling.
FLAT_FULLBAND_FRAME = frame(flat_fullband_96k(), 48000.0, 0.7)

#: A 96 kHz container whose content stops dead at 22.5 kHz, 0.7 s per frame.
CUT_22K5_FRAME = frame(cutoff_96k(22500.0), 48000.0, 0.7)

#: The same 22.5 kHz ceiling declaring 0.2 s per wire frame, so one ingested hop
#: covers 0.8 s of playback and two cover 1.6 s.
CUT_22K5_SHORT_FRAME = frame(cutoff_96k(22500.0), 48000.0, 0.2)


async def _digest(stream: MeteringStream) -> None:
    """Wait until the wire is drained, then let the reader chew the buffered tail."""
    await asyncio.wait_for(stream.flushed(), 3.0)
    for _ in range(100):
        await asyncio.sleep(0)


def _counted(reader: Any) -> int:
    """How many decimated hops the reader has ingested so far."""
    aggregate = reader.aggregate()
    return 0 if aggregate is None else int(aggregate.frames)


async def _ingested(stream: MeteringStream, reader: Any, hops: int) -> None:
    """Wait until the wire is drained and the reader has counted ``hops``
    ingested frames — it samples every DECIMATE-th frame off the wire, so the
    batch is drained when the count stops short of nothing."""
    await asyncio.wait_for(stream.flushed(), 3.0)
    await eventually(lambda: _counted(reader) >= hops)


async def _earn_20k(stream: MeteringStream, reader: Any) -> None:
    """Earn the brick-wall verdict from a bounded batch, wire fully drained."""
    stream.send(FAKE_HIRES_FRAME, count=60)  # ≈ 42 s of covered playback
    await eventually(lambda: reader.recommendation() is not None)
    await _digest(stream)


async def test_a_verdict_follows_the_window_and_does_not_outlive_it(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        stream.send(CUT_22K5_FRAME, count=DECIMATE)  # one hop, 2.8 s of the 22.5 kHz ceiling
        await _ingested(stream, reader, 1)
        earned = reader.recommendation() or {}
        stream.send(FLAT_FULLBAND_FRAME, count=DECIMATE * 2)  # further coverage, no ceiling
        await _ingested(stream, reader, 3)
        assert (earned["filter"], reader.recommendation()) == ("20k", None)


async def test_no_verdict_until_the_window_is_covered(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        stream.send(CUT_22K5_SHORT_FRAME, count=DECIMATE)  # one hop, 0.8 s: short of the window
        await _ingested(stream, reader, 1)
        early = reader.recommendation()
        stream.send(CUT_22K5_SHORT_FRAME, count=DECIMATE)  # a second hop, 1.6 s of the same ceiling
        await _ingested(stream, reader, 2)
        assert (early, (reader.recommendation() or {})["filter"]) == (None, "20k")


async def test_track_change_clears_the_verdict(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        await _earn_20k(stream, reader)
        cell[0] = replace(PLAYING, track_serial="track-2")
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


async def test_stream_loss_clears_the_verdict(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        await _earn_20k(stream, reader)
        await stream.close()  # the metering connection breaks mid-track
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


async def test_engaging_the_recommended_filter_quiets_the_verdict(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        await _earn_20k(stream, reader)
        cell[0] = replace(PLAYING, junk_filter="20k")
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


# --- MeteringReader: wire-level silence -------------------------------------------

SPUR_FRAME = frame(spur_min_176(40000.0), 88200.0, 0.7)
#: All-floor spectrum with every channel's RMS at -95 dBFS — below the -90
#: silence threshold, so it must never lower the windowed minimum.
SILENT_WIRE_FRAME = frame([-140.0] * WIRE_BINS, 88200.0, 0.7, rms=-95.0)

PLAYING_176 = replace(PLAYING, samplerate=176400)


async def test_wire_silent_frames_do_not_erase_a_persistent_tone(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING_176]
    async with running_reader(port, cell) as (reader, _):
        # The reader samples every DECIMATE-th wire frame, so a strictly
        # periodic tone/silent pattern can alias against the sampler. A period
        # of DECIMATE + 1 is coprime with it, so the sampled positions walk
        # through the whole pattern and ingest tone AND silent frames alike.
        for _ in range(25):  # ≈ 87 s total, ≈ 70 s of it tone-carrying frames
            stream.send(SPUR_FRAME, count=DECIMATE)
            stream.send(SILENT_WIRE_FRAME)
        await eventually(lambda: reader.recommendation() is not None)
        assert (reader.recommendation() or {})["filter"] == "30k"
