"""The junk-filter advisor: per-track average spectra classified into advice.

`classify` is pure, so the signature cases (fake hi-res cliff, HF spur,
noise-shaping ramp) are synthesized spectra handed straight in (`junk_spectra`).
The reader cases run against a fake 4322 stream speaking the real binary frame
layout over a real socket (`fake_metering`, protocol.md §7); the context cases
run against the fake control daemon through a real `ConnectionManager`.

Known gap: the spec's `/api/status` case names "the existing API client
fixture", but `api_client` (closed control port) answers 503 on /api/status
before any daemon load, so the payload case runs on `live_api` — the offline
app whose control daemon is fake and whose metering port has no listener.
"""

import asyncio
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from conftest import PLAYING, eventually, running_reader, spawn_threaded_daemon, wait_for_api
from fake_metering import frame, spawn_threaded_stream
from fastapi.testclient import TestClient
from junk_spectra import (
    FAKE_HIRES_FRAME,
    decaying_176,
    fake_hires_96k,
    genuine_hires_96k,
    shaping_ramp_176,
    spectrum,
    spur_min_176,
)

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.junkadvisor import MIN_SECONDS, classify
from hqptuner.manager import ConnectionManager
from hqptuner.metering import TrackContext, context_from


def _classify(
    levels: list[float],
    bandwidth: float,
    *,
    seconds: float = 60.0,
    samplerate: int | None = 96000,
    sdm: bool = False,
    junk_filter: str | None = "none",
    min_levels_db: list[float] | None = None,
) -> dict[str, Any] | None:
    return classify(
        levels,
        bandwidth,
        seconds,
        samplerate=samplerate,
        sdm=sdm,
        junk_filter=junk_filter,
        min_levels_db=min_levels_db,
    )


def _classify_spur(
    tone_hz: float, *, junk_filter: str | None = "none", tone_db: float = -45.0
) -> dict[str, Any] | None:
    """The spur rule reads the windowed minimum spectrum: the tone rides in
    ``min_levels_db`` while the mean alongside is ordinary decaying music."""
    return _classify(
        decaying_176(),
        88200.0,
        samplerate=176400,
        junk_filter=junk_filter,
        min_levels_db=spur_min_176(tone_hz, tone_db),
    )


# --- classify: guards -----------------------------------------------------------


def test_no_verdict_below_the_minimum_coverage() -> None:
    assert _classify(fake_hires_96k(), 48000.0, seconds=MIN_SECONDS - 0.1) is None


def test_sdm_source_gets_no_verdict() -> None:
    assert _classify(fake_hires_96k(), 48000.0, sdm=True) is None


@pytest.mark.parametrize("samplerate", [None, 44100, 48000])
def test_unknown_or_non_hires_samplerate_gets_no_verdict(samplerate: int | None) -> None:
    assert _classify(fake_hires_96k(), 48000.0, samplerate=samplerate) is None


def test_narrow_bandwidth_gets_no_verdict() -> None:
    # the tap only shows the audible band — nothing above it to judge
    levels = spectrum(24000.0, lambda f: -20.0 if f <= 22000.0 else -140.0)
    assert _classify(levels, 24000.0) is None


# --- classify: signatures -------------------------------------------------------


def test_fake_hires_recommends_the_20k_filter() -> None:
    verdict = _classify(fake_hires_96k(), 48000.0)
    assert verdict is not None and verdict["filter"] == "20k"


def test_fake_hires_reason_names_the_filter() -> None:
    verdict = _classify(fake_hires_96k(), 48000.0)
    assert verdict is not None and "20k" in verdict["reason"]


def test_fake_hires_reports_the_content_ceiling() -> None:
    verdict = _classify(fake_hires_96k(), 48000.0)
    assert verdict is not None and abs(verdict["ceiling_khz"] - 22.0) <= 1.5


def test_genuine_hires_gets_no_verdict() -> None:
    assert _classify(genuine_hires_96k(), 48000.0) is None


def test_hf_tone_in_the_mean_alone_earns_no_spur_verdict() -> None:
    # without the minimum spectrum there is no persistence evidence to read
    assert _classify(spur_min_176(40000.0), 88200.0, samplerate=176400, min_levels_db=None) is None


@pytest.mark.parametrize(
    ("tone_hz", "expected"),
    [
        (40000.0, "30k"),
        (44000.0, "30k"),  # just under the 45 kHz corner split
        (46000.0, "40k"),  # just over it
        (60000.0, "40k"),
    ],
)
def test_persistent_hf_tone_recommends_a_rolloff_above_the_tone(tone_hz: float, expected: str) -> None:
    verdict = _classify_spur(tone_hz)
    assert verdict is not None and verdict["filter"] == expected


def test_spur_reason_names_the_filter() -> None:
    verdict = _classify_spur(40000.0)
    assert verdict is not None and "30k" in verdict["reason"]


def test_spur_reports_the_tone_ceiling() -> None:
    verdict = _classify_spur(40000.0)
    assert verdict is not None and abs(verdict["ceiling_khz"] - 40.0) <= 1.5


def test_tone_below_25_khz_earns_no_spur_verdict() -> None:
    # spur hunting starts at 25 kHz — a tone just under it is the music's business
    assert _classify_spur(24500.0) is None


def test_tone_under_15_db_above_the_minimum_baseline_earns_no_verdict() -> None:
    # the minimum-spectrum floor at 40 kHz is -140; -130 stands only 10 dB proud
    assert _classify_spur(40000.0, tone_db=-130.0) is None


def test_noise_shaping_ramp_recommends_the_50k_filter() -> None:
    verdict = _classify(shaping_ramp_176(), 88200.0, samplerate=176400)
    assert verdict is not None and verdict["filter"] == "50k"


# --- classify: engaged-filter suppression ---------------------------------------


@pytest.mark.parametrize("engaged", [None, "none"])
def test_no_engaged_filter_never_suppresses(engaged: str | None) -> None:
    verdict = _classify_spur(40000.0, junk_filter=engaged)
    assert verdict is not None and verdict["filter"] == "30k"


@pytest.mark.parametrize(
    "engaged",
    [
        "20k",  # fixed corner below the recommendation suppresses
        "30k",  # ... and so does the recommended corner itself
        "2x",  # rate-relative always suppresses
        "4x",
        "8x",
    ],
)
def test_engaged_filter_suppresses_a_covered_spur_verdict(engaged: str) -> None:
    assert _classify_spur(40000.0, junk_filter=engaged) is None


def test_engaged_corner_above_the_recommendation_does_not_suppress() -> None:
    verdict = _classify(fake_hires_96k(), 48000.0, junk_filter="50k")
    assert verdict is not None and verdict["filter"] == "20k"


# --- MeteringReader against the fake 4322 stream --------------------------------


async def test_fake_hires_stream_yields_20k_advice(metering_stream: Callable[..., Any]) -> None:
    _, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        await eventually(lambda: reader.recommendation() is not None)
        verdict = reader.recommendation()
        assert verdict is not None and verdict["filter"] == "20k"


async def test_frames_streamed_while_paused_buy_no_coverage(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [replace(PLAYING, playing=False)]
    async with running_reader(port, cell) as (reader, _):
        stream.send(FAKE_HIRES_FRAME, count=200)  # ≈ 140 s of damning spectrum
        await asyncio.wait_for(stream.flushed(), 3.0)
        for _ in range(100):  # let the reader digest the buffered tail
            await asyncio.sleep(0)
        assert reader.recommendation() is None


async def test_coverage_is_measured_in_seconds_not_frames(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    short_hop = frame(fake_hires_96k(), 48000.0, 0.05)  # 60 frames but only ≈ 3 s
    async with running_reader(port, cell) as (reader, _):
        stream.send(short_hop, count=60)
        await asyncio.wait_for(stream.flushed(), 3.0)
        for _ in range(100):  # let the reader digest the buffered tail
            await asyncio.sleep(0)
        assert reader.recommendation() is None


async def test_track_change_resets_the_evidence(metering_stream: Callable[..., Any]) -> None:
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        # 30 frames ≈ 21 s: enough for advice, but small enough that whatever
        # backlog outlives the wait cannot re-earn the minimum for track-2
        stream.send(FAKE_HIRES_FRAME, count=30)
        await eventually(lambda: reader.recommendation() is not None)
        await stream.flushed()  # consume the backlog while still on track-1
        cell[0] = replace(PLAYING, track_serial="track-2")
        stream.send(FAKE_HIRES_FRAME, count=2)  # ≈ 1.4 s — nowhere near re-earned
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


async def test_unreachable_stream_retries_through_the_injected_sleep(closed_port: int) -> None:
    sleeps: list[float] = []

    async def backoff(seconds: float) -> None:
        sleeps.append(seconds)
        await asyncio.sleep(0)

    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(closed_port, cell, sleep=backoff):
        await eventually(lambda: len(sleeps) >= 3)
        assert len(sleeps) >= 3


async def test_unreachable_stream_has_no_recommendation(closed_port: int) -> None:
    sleeps: list[float] = []

    async def backoff(seconds: float) -> None:
        sleeps.append(seconds)
        await asyncio.sleep(0)

    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(closed_port, cell, sleep=backoff) as (reader, _):
        await eventually(lambda: len(sleeps) >= 3)
        assert reader.recommendation() is None


async def test_lost_context_silences_accumulated_advice(metering_stream: Callable[..., Any]) -> None:
    _, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        await eventually(lambda: reader.recommendation() is not None)
        cell[0] = None  # daemon went unreachable
        await eventually(lambda: reader.recommendation() is None)
        assert reader.recommendation() is None


async def test_stop_finishes_a_running_reader(metering_stream: Callable[..., Any]) -> None:
    _, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, task):
        await eventually(lambda: reader.recommendation() is not None)  # mid-stream
        reader.stop()
        done, _pending = await asyncio.wait({task}, timeout=3.0)
        assert task in done


# --- context_from against the fake control daemon -------------------------------

METADATA_96K_PCM = '<metadata samplerate="96000" sdm="0"/>'


async def test_context_is_none_while_the_manager_is_unreachable(closed_port: int) -> None:
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=closed_port))
    try:
        assert context_from(manager) is None
    finally:
        await manager.aclose()


def _settled(manager: ConnectionManager) -> bool:
    context = context_from(manager)
    return context is not None and context.samplerate is not None


@pytest.mark.parametrize(("field", "expected"), [("playing", True), ("samplerate", 96000), ("sdm", False)])
async def test_playing_96k_pcm_track_shapes_the_context(live_manager: Any, field: str, expected: object) -> None:
    manager, _, _ = await live_manager(poll_interval=0.05, state="2", _metadata=METADATA_96K_PCM)
    await eventually(lambda: _settled(manager))
    assert getattr(context_from(manager), field) == expected


async def test_sdm_metadata_marks_the_context_sdm(live_manager: Any) -> None:
    sdm_metadata = '<metadata samplerate="96000" sdm="1"/>'
    manager, _, _ = await live_manager(poll_interval=0.05, state="2", _metadata=sdm_metadata)
    await eventually(lambda: _settled(manager))
    context = context_from(manager)
    assert context is not None and context.sdm is True


# --- /api/status payload --------------------------------------------------------


def test_status_payload_carries_a_null_junk_verdict_offline(live_api: TestClient) -> None:
    # the offline app's metering port has no listener, so the advisor is silent
    assert live_api.get("/api/status").json()["data"]["junk"] is None


@pytest.fixture
def advising_app_client(tmp_path: Path) -> Iterator[TestClient]:
    """The full app on a threaded fake control daemon that reports a playing
    96 kHz PCM track, with its metering lane wired to a threaded fake 4322
    stream carrying the fake-hi-res spectrum with generous coverage per frame.

    Control lane only — no credentials, so the app never opens the 8088 lane
    (which defaults at the host's real daemon), and every store path is under
    tmp_path so a preset import cannot land in the repo's own state."""
    daemon = spawn_threaded_daemon({"state": "2", "_metadata": METADATA_96K_PCM})
    stream = spawn_threaded_stream(FAKE_HIRES_FRAME)
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=next(daemon),
        hqp_metering_port=next(stream),
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        poll_interval=0.02,
    )
    try:
        with TestClient(create_app(cfg)) as client:
            yield client
    finally:
        next(stream, None)
        next(daemon, None)


def test_status_payload_serves_the_advisors_verdict(advising_app_client: TestClient) -> None:
    def advised(client: TestClient) -> bool:
        payload = client.get("/api/status").json()
        return bool((payload.get("data") or {}).get("junk"))

    wait_for_api(advising_app_client, advised)
    assert advising_app_client.get("/api/status").json()["data"]["junk"]["filter"] == "20k"
