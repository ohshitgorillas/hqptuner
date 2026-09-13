"""The metering reader's idle gate: it only holds the 4322 side channel open
while the engine is actually playing.

The socket cases run a real `MeteringReader` against the fake 4322 stream
(`fake_metering`, protocol.md §7) and read the connection lifecycle off the
listener itself — `accepts` counts every client it ever took, `connected` how
many are attached now — so "the reader let go" is observed on the wire rather
than asked of the reader.

The idle loop's pacing is read through the reader's injected ``sleep`` seam
(docs/testing.md §7): an idle pass is one recorded sleep, never a wall-clock
wait. Where a case has to let a stretch of reader life go by before it can
assert, it waits on further recorded sleeps, never on the thing it is about to
assert.

The config cases build a `Config` under a patched environment. The app cases
run the whole REST app on a threaded fake control daemon that reports a playing
96 kHz PCM track plus a threaded fake 4322 stream, so "nothing ever connects"
is the listener's own accept count; the metering-off cases run their app
alongside a metering-on one and take that one's first accept as the gate, so
the silent app is always given at least as much of its own loop as the dialing
app needed."""

import asyncio
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pytest
from conftest import PLAYING, eventually, running_reader
from fake_metering import MeteringStream
from junk_spectra import FAKE_HIRES_FRAME

from hqptuner.config import Config
from hqptuner.engine import metering

PAUSED = replace(PLAYING, playing=False)

METADATA_96K_PCM = '<metadata samplerate="96000" sdm="0"/>'


def _cell(context: metering.TrackContext | None) -> list[metering.TrackContext | None]:
    """The one-slot window the reader reads its context out of; a test moves the
    engine by writing to it."""
    return [context]


def _recorder() -> tuple[list[float], Callable[[float], Any]]:
    """An injected sleep that pays its waits in recorded seconds, not real ones."""
    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        await asyncio.sleep(0)

    return sleeps, sleep


async def _passes(sleeps: list[float], count: int) -> None:
    """Let ``count`` further reader passes go by, counted on the sleep seam."""
    mark = len(sleeps)
    await eventually(lambda: len(sleeps) >= mark + count)


async def _earn_20k(stream: MeteringStream, reader: Any) -> None:
    """Earn the brick-wall verdict from a bounded batch, wire fully drained."""
    stream.send(FAKE_HIRES_FRAME, count=60)  # ≈ 42 s, past the 30 s window
    await eventually(lambda: reader.recommendation() is not None)
    await asyncio.wait_for(stream.flushed(), 3.0)
    for _ in range(100):  # let the reader chew the buffered tail
        await asyncio.sleep(0)


# --- the connection follows the engine's play state -------------------------


async def test_a_playing_engine_keeps_a_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PLAYING)
    async with running_reader(port, cell):
        await eventually(lambda: stream.accepts >= 1)
        assert stream.connected == 1


async def test_a_not_playing_engine_leaves_no_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PLAYING)
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        # the wait above only caught a moment with nobody attached; the accept
        # count says the reader let go for good rather than thrashing the port
        assert stream.accepts == 1


async def test_an_idle_reader_opens_no_new_connection(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PAUSED)
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: len(sleeps) >= 5)  # five idle re-checks gone by
        assert stream.accepts == 0


async def test_no_new_client_connects_after_the_idle_close(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PLAYING)
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        at_close = stream.accepts
        await _passes(sleeps, 5)  # five idle re-checks after the close
        assert stream.accepts == at_close


async def test_an_idle_reader_pays_a_wait_between_context_checks(
    metering_stream: Callable[..., Any],
) -> None:
    _stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PAUSED)
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: len(sleeps) >= 3)
        # every idle pass is paid for: an idle reader waits between context
        # checks rather than spinning on them
        assert min(sleeps) > 0


async def test_an_unreachable_manager_leaves_no_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PLAYING)
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = None  # the manager lost the daemon
        await eventually(lambda: stream.connected == 0)
        assert stream.accepts == 1  # let go for good, not redialed


# --- pausing and resuming inside one track ----------------------------------


async def test_resuming_the_same_track_reconnects_to_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell = _cell(PLAYING)
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        before = stream.accepts
        cell[0] = PLAYING
        await eventually(lambda: stream.connected == 1)
        assert stream.accepts == before + 1  # one fresh dial, not a redial storm


async def test_the_idle_close_keeps_the_verdict_earned_before_the_pause(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell = _cell(PLAYING)
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep) as (reader, _task):
        await _earn_20k(stream, reader)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        cell[0] = PLAYING  # same track_serial: the evidence is still this track's
        await eventually(lambda: stream.connected == 1)
        assert (reader.recommendation() or {})["filter"] == "20k"


async def test_a_stream_that_ends_while_playing_discards_the_verdict(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell = _cell(PLAYING)
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep) as (reader, _task):
        await _earn_20k(stream, reader)
        await stream.close()  # not the idle gate: the daemon hung up, EOF
        await _passes(sleeps, 3)  # the reader has been round its retry a few times
        assert reader.recommendation() is None


async def test_a_stream_that_errors_while_playing_discards_the_verdict(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell = _cell(PLAYING)
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep) as (reader, _task):
        await _earn_20k(stream, reader)
        await stream.crash()  # the connection broke under the reader: a read error
        await _passes(sleeps, 3)
        assert reader.recommendation() is None


# --- the config switch ------------------------------------------------------


def test_metering_is_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HQPTUNER_METERING_ENABLED", raising=False)
    assert Config().metering_enabled is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "No", "off", "OFF"])
def test_a_falsey_env_value_disables_metering(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_a_truthy_env_value_leaves_metering_enabled(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.delenv("HQPTUNER_METERING_ENABLED", raising=False)
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is True
