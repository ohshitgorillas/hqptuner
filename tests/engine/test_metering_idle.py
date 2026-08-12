"""The metering reader's idle gate: it only holds the 4322 side channel open
while the engine is actually playing.

The socket cases run a real `MeteringReader` against the fake 4322 stream
(`fake_metering`, protocol.md §7) and read the connection lifecycle off the
listener itself — `accepts` counts every client it ever took, `connected` how
many are attached now — so "the reader let go" is observed on the wire rather
than asked of the reader.

The idle loop's pacing is read through the reader's injected ``sleep`` seam
(docs/testing.md §7): an idle pass is one recorded sleep, never a wall-clock
wait.

The config cases build a `Config` under a patched environment, and the app
cases run the whole REST app on a threaded fake control daemon that reports a
playing 96 kHz PCM track plus a threaded fake 4322 stream, so "nothing ever
connects" is the listener's own accept count."""

import asyncio
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from conftest import PLAYING, eventually, running_reader, spawn_threaded_daemon, wait_for_api
from fake_metering import MeteringStream, spawn_threaded
from fastapi.testclient import TestClient
from junk_spectra import FAKE_HIRES_FRAME

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine import metering

PAUSED = replace(PLAYING, playing=False)

METADATA_96K_PCM = '<metadata samplerate="96000" sdm="0"/>'


def _recorder() -> tuple[list[float], Callable[[float], Any]]:
    """An injected sleep that pays its waits in recorded seconds, not real ones."""
    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        await asyncio.sleep(0)

    return sleeps, sleep


async def _earn_20k(stream: MeteringStream, reader: Any) -> None:
    """Earn the brick-wall verdict from a bounded batch, wire fully drained."""
    stream.send(FAKE_HIRES_FRAME, count=30)  # ≈ 21 s, past the 15 s minimum
    await eventually(lambda: reader.recommendation() is not None)
    await asyncio.wait_for(stream.flushed(), 3.0)
    for _ in range(100):  # let the reader chew the buffered tail
        await asyncio.sleep(0)


# --- the connection follows the engine's play state -------------------------


async def test_a_playing_engine_keeps_a_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PLAYING]
    async with running_reader(port, cell):
        await eventually(lambda: stream.accepts >= 1)
        assert stream.connected == 1


async def test_a_not_playing_engine_leaves_no_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PLAYING]
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        assert stream.connected == 0


async def test_an_idle_reader_opens_no_new_connection(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PAUSED]
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: len(sleeps) >= 5)  # five idle re-checks gone by
        assert stream.accepts == 0


async def test_an_idle_reader_waits_the_idle_recheck_between_context_checks(
    metering_stream: Callable[..., Any],
) -> None:
    _stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PAUSED]
    sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: len(sleeps) >= 3)
        assert metering.IDLE_RECHECK in sleeps


async def test_an_unreachable_manager_leaves_no_client_on_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PLAYING]
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = None  # the manager lost the daemon
        await eventually(lambda: stream.connected == 0)
        assert stream.connected == 0


# --- pausing and resuming inside one track ----------------------------------


async def test_resuming_the_same_track_reconnects_to_the_metering_port(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[metering.TrackContext | None] = [PLAYING]
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep):
        await eventually(lambda: stream.connected == 1)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        cell[0] = PLAYING
        await eventually(lambda: stream.connected == 1)
        assert stream.accepts >= 2


async def test_the_idle_close_keeps_the_verdict_earned_before_the_pause(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell: list[metering.TrackContext | None] = [PLAYING]
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep) as (reader, _task):
        await _earn_20k(stream, reader)
        cell[0] = PAUSED
        await eventually(lambda: stream.connected == 0)
        cell[0] = PLAYING  # same track_serial: the evidence is still this track's
        await eventually(lambda: stream.connected == 1)
        verdict = reader.recommendation()
        assert verdict is not None and verdict["filter"] == "20k"


async def test_a_stream_that_breaks_while_playing_still_discards_the_verdict(
    metering_stream: Callable[..., Any],
) -> None:
    stream, port = await metering_stream()
    cell: list[metering.TrackContext | None] = [PLAYING]
    _sleeps, sleep = _recorder()
    async with running_reader(port, cell, sleep=sleep) as (reader, _task):
        await _earn_20k(stream, reader)
        await stream.close()  # not the idle gate: the connection broke
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


# --- the config switch ------------------------------------------------------


def test_metering_is_enabled_by_default() -> None:
    assert Config().metering_enabled is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "No", "off", "OFF"])
def test_a_falsey_env_value_disables_metering(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_a_truthy_env_value_leaves_metering_enabled(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is True


# --- the whole app with metering switched off -------------------------------

AppOnStream = tuple[TestClient, MeteringStream]


def _app_on_stream(tmp_path: Path, *, metering_enabled: bool) -> Iterator[AppOnStream]:
    """The full app on a threaded fake control daemon reporting a playing
    96 kHz PCM track, with a threaded fake 4322 stream on its metering port —
    so an app that ever dials metering is caught by the listener's accept count.

    Control lane only: no credentials, so the app never opens the 8088 lane,
    and every store path is under tmp_path."""
    daemon = spawn_threaded_daemon({"state": "2", "_metadata": METADATA_96K_PCM})
    stream = spawn_threaded(FAKE_HIRES_FRAME)
    listener, port = next(stream)
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=next(daemon),
        hqp_metering_port=port,
        metering_enabled=metering_enabled,
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        poll_interval=0.02,
    )
    try:
        with TestClient(create_app(cfg)) as client:
            yield client, listener
    finally:
        next(stream, None)
        next(daemon, None)


def _loaded(client: TestClient) -> bool:
    return client.get("/api/status").json().get("data") is not None


@pytest.fixture
def metering_off_app(tmp_path: Path) -> Iterator[AppOnStream]:
    yield from _app_on_stream(tmp_path, metering_enabled=False)


@pytest.fixture
def metering_on_app(tmp_path: Path) -> Iterator[AppOnStream]:
    yield from _app_on_stream(tmp_path, metering_enabled=True)


def test_a_metering_enabled_app_connects_to_the_metering_port(metering_on_app: AppOnStream) -> None:
    client, listener = metering_on_app
    # the predicate must keep making requests: wait_for_api advances the app's
    # own loop between tries, and a check that never calls it spins past the
    # reader's first idle tick in microseconds
    wait_for_api(client, lambda c: _loaded(c) and listener.accepts >= 1)
    assert listener.accepts >= 1


def test_a_metering_disabled_app_never_connects_to_the_metering_port(metering_off_app: AppOnStream) -> None:
    client, listener = metering_off_app
    wait_for_api(client, _loaded)
    assert listener.accepts == 0


def test_a_metering_disabled_app_still_answers_status(metering_off_app: AppOnStream) -> None:
    client, _listener = metering_off_app
    wait_for_api(client, _loaded)
    assert client.get("/api/status").status_code == 200


def test_a_metering_disabled_app_serves_a_null_junk_recommendation(metering_off_app: AppOnStream) -> None:
    client, _listener = metering_off_app
    wait_for_api(client, _loaded)
    assert client.get("/api/status").json()["data"]["junk"] is None
