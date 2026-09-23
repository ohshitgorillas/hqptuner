#!/usr/bin/env python3
"""Capture whole metering bursts while hi-res content plays, keeping every frame byte for byte.

``hqptuner/core/junkcal.py`` writes one row per poll carrying the detector's folded aggregate: per-bin minima over a
window, decimated to every fourth frame. That corpus answers questions about the detector's arithmetic and cannot
answer questions about the stream it folded, because the frames are gone by the time a row is written.

This script keeps the frames. It polls ``ControlClient.get_status`` on a slow tick and, whenever the engine is playing
a track above ``RATE_FLOOR``, connects to the metering port, reads ``BURST_SECONDS`` of frames with the header struct
and the payload sizing ``MeteringReader._read_frame`` uses, and disconnects. Each frame's header and body are stored
exactly as they arrived, base64 over the raw bytes, with the arrival time beside them: nothing is unpacked into the
file, nothing decimated, nothing thresholded, no minimum folded. The status samplerate and the engaged junk filter
ride at the top of the file so a burst can be attributed without a second source.

The metering connection exists only inside a burst. Between bursts the socket is closed and the daemon carries no
reader of ours. A burst starts no sooner than ``BURST_PERIOD`` after the previous one started, so a long hi-res album
yields a sampling of bursts rather than a continuous capture.

Writes one gzipped JSON file per burst under ``DEST``, named by the burst's UTC start. Runs until SIGTERM or SIGINT.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import gzip
import json
import signal
import struct
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from hqptuner.config import Config
from hqptuner.engine.control import ControlClient, ControlError
from hqptuner.engine.metering import HEADER, MAX_BINS, MAX_CHANNELS, PLAYING

#: Where bursts land, one file each.
DEST = Path("/srv/hqptuner/state/junkburst")

#: How often the engine's status is asked whether a burst is due.
POLL_SECONDS = 10.0

#: Frames are kept for this long once a burst opens.
BURST_SECONDS = 5.0

#: A burst starts no sooner than this after the previous burst started.
BURST_PERIOD = 120.0

#: Content at or below this rate is not hi-res and is not captured.
RATE_FLOOR = 48_000


def _int(value: str | None) -> int | None:
    """Parse an attribute that should be an integer, returning None when it is absent or malformed."""
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _junk_filter_name(state: dict[str, str], enum: list[dict[str, str]]) -> str | None:
    """``State.filter_junk`` joined against the running enumeration, which is the sole authority for index→name."""
    idx = state.get("filter_junk")
    for item in enum:
        if item.get("index") == idx:
            return item.get("name")
    return None


class BurstReader:
    """One metering connection, opened for a burst and closed when it ends."""

    def __init__(self, host: str, port: int) -> None:
        """Record where to dial; no socket is opened until ``capture``."""
        self._host = host
        self._port = port

    async def capture(self, seconds: float, stop: asyncio.Event) -> list[dict[str, Any]]:
        """Connect, read frames until ``seconds`` have passed or ``stop`` is set, disconnect, return the frames.

        The deadline is checked between frames rather than enforced on the read, so a frame that has started to arrive
        is taken whole; a stream that goes silent is let go by the stop race rather than by blocking in ``readexactly``
        until the daemon speaks again.
        """
        reader, writer = await asyncio.open_connection(self._host, self._port)
        frames: list[dict[str, Any]] = []
        deadline = time.monotonic() + seconds
        try:
            while time.monotonic() < deadline and not stop.is_set():
                read = asyncio.create_task(self._read_frame(reader))
                waiter = asyncio.ensure_future(_wait(stop, deadline - time.monotonic()))
                try:
                    await asyncio.wait({read, waiter}, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    waiter.cancel()
                if not read.done():
                    read.cancel()
                    with contextlib.suppress(asyncio.CancelledError, OSError, asyncio.IncompleteReadError):
                        await read
                    break
                header, body = read.result()
                frames.append(
                    {
                        "arrived": time.time(),
                        "header": base64.b64encode(header).decode("ascii"),
                        "body": base64.b64encode(body).decode("ascii"),
                    }
                )
            return frames
        finally:
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()

    async def _read_frame(self, reader: asyncio.StreamReader) -> tuple[bytes, bytes]:
        """Read one frame, returning the header and body bytes exactly as the daemon sent them.

        Sized as ``MeteringReader._read_frame`` sizes it: a fixed header, then ``channels * (16 + 8 * bins)`` of
        payload. The header is unpacked only to learn those two counts; the bytes handed back are the raw ones.
        """
        raw = await reader.readexactly(HEADER.size)
        header = HEADER.unpack(raw)
        channels, bins = int(header[1]), int(header[2])
        if not (0 < channels <= MAX_CHANNELS and 1 < bins <= MAX_BINS):
            raise OSError(f"implausible metering header (channels={channels}, bins={bins})")
        return raw, await reader.readexactly(channels * (16 + 8 * bins))


async def _wait(stop: asyncio.Event, seconds: float) -> None:
    """Return when ``stop`` is set or ``seconds`` have passed, whichever comes first."""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), max(seconds, 0.0))


def _write(
    started: datetime,
    samplerate: int,
    junk_filter: str | None,
    extra: dict[str, Any],
    frames: list[dict[str, Any]],
) -> Path:
    """Write one burst as a gzipped JSON document and return its path."""
    DEST.mkdir(parents=True, exist_ok=True)
    path = DEST / f"junkburst-{started:%Y%m%dT%H%M%SZ}.json.gz"
    document = {
        "schema": "junkburst/1",
        "started": started.isoformat(),
        "samplerate": samplerate,
        "junk_filter": junk_filter,
        "header_format": HEADER.format,
        "body_layout": "channels * (16 + 8 * bins) bytes, as received",
        "frames": frames,
        **extra,
    }
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(document, fh)
    return path


async def _burst(
    client: ControlClient,
    meter: BurstReader,
    status: dict[str, str],
    rate: int,
    stop: asyncio.Event,
) -> None:
    """Capture one burst and write it, carrying the status and the engaged junk filter beside the frames."""
    state = await client.get_state()
    enum = await client.get_enumeration("GetJunkFilters")
    started = datetime.now(UTC)
    frames = await meter.capture(BURST_SECONDS, stop)
    extra = {"status": status, "state": state, "junk_filters": enum, "filter_junk": state.get("filter_junk")}
    path = _write(started, rate, _junk_filter_name(state, enum), extra, frames)
    print(f"{path} frames={len(frames)} bytes={path.stat().st_size}", flush=True)


def _due(status: dict[str, str], meta: dict[str, str] | None) -> int | None:
    """Return the samplerate to capture at, or None when the engine is not playing hi-res content."""
    if _int(status.get("state")) != PLAYING:
        return None
    rate = _int((meta or {}).get("samplerate"))
    return rate if rate is not None and rate > RATE_FLOOR else None


async def _run() -> None:
    """Poll for hi-res playback and take one burst per ``BURST_PERIOD``, until stopped."""
    cfg = Config()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    client = ControlClient(cfg.hqp_host, cfg.hqp_control_port, cfg.request_timeout)
    meter = BurstReader(cfg.hqp_host, cfg.hqp_metering_port)
    await client.connect()
    last = -BURST_PERIOD
    try:
        while not stop.is_set():
            try:
                status, meta = await client.get_status()
                rate = _due(status, meta)
                if rate is not None and time.monotonic() - last >= BURST_PERIOD:
                    last = time.monotonic()
                    await _burst(client, meter, status, rate, stop)
            except (ControlError, OSError, asyncio.IncompleteReadError, struct.error) as exc:
                print(f"burst skipped: {exc}", file=sys.stderr, flush=True)
            await _wait(stop, POLL_SECONDS)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(_run())
