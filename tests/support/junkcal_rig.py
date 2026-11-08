"""The calibration capture's world: a manager on the fake daemon, a metering reader on the fake 4322 stream.

The frames are the caller's (docs/testing.md rule 13): ``frame`` packs the wire layout `test_status_bands` documents,
a floor of power in every bin, and the case chooses the geometry and whether the engine's levels read as silence.
``Rig`` holds what the case arranges (which stream the manager's reader is attached to, what the daemon reports) and
returns what it finds; every assertion stays in the test.
"""

import asyncio
import contextlib
import functools
import json
import struct
from collections.abc import Callable
from pathlib import Path
from typing import Any

import fake_metering
import fake_network
from apps import advanced
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.core import junkcal
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.metering import MeteringReader
from hqptuner.engine.trackcontext import context_from

TRANSFORM_BITS = 11
TRANSFORM_TIME = 0.1
VERSION = 1
CHANNELS = 2
FLOOR_REAL = 1e-3

#: peakMax, peak, rms, rmsMax in dBFS: a level well above the silence floor, and one far below it.
LEVELS_AUDIBLE = (-3.0, -6.0, -20.0, -18.0)
LEVELS_SILENT = (-120.0, -120.0, -120.0, -120.0)

#: What `State` reports while the engine plays and while it does not.
PLAYING = "2"
STOPPED = "0"

#: Poll passes a case lets the manager or the reader catch up in before it calls the fixture broken.
POLLS = 20


def frame(*, bins: int, bandwidth: float, silent: bool = False) -> bytes:
    """One metering frame of ``bins`` bins spanning ``bandwidth`` Hz, a floor of power in every bin."""
    header = struct.pack("<4I3fI", VERSION, CHANNELS, bins, TRANSFORM_BITS, bandwidth, TRANSFORM_TIME, 0.0, 0)
    levels = LEVELS_SILENT if silent else LEVELS_AUDIBLE
    channel = struct.pack(f"<4f{bins}f{bins}f", *levels, *([FLOOR_REAL] * bins), *([0.0] * bins))
    return header + channel * CHANNELS


def metadata(samplerate: int) -> str:
    """The Status ``metadata`` child of a track at ``samplerate``."""
    return f'<metadata samplerate="{samplerate}"/>'


def rows_by_file(dest: Path) -> list[list[dict[str, Any]]]:
    """Every period file under ``dest`` in the order it was claimed, each as its parsed rows."""
    files = sorted(dest.glob("junkcal-*.jsonl"), key=lambda path: (len(path.name), path.name))
    return [[json.loads(line) for line in path.read_text().splitlines()] for path in files]


def block_directory(dest: Path) -> None:
    """Put a plain file where the capture directory would go, so creating the directory fails."""
    dest.write_text("a file where the directory should be")


def unblock_directory(dest: Path) -> None:
    """Take the file ``block_directory`` put at ``dest`` away again."""
    dest.unlink()


class Rig:
    """A connected manager, the streams its metering reader has been attached to, and the capture tasks started."""

    def __init__(self, mgr: ConnectionManager, state: dict[str, str]) -> None:
        """Hold the manager and the daemon's live State; nothing is attached until ``attach``."""
        if not isinstance(mgr.clock, VirtualClock):
            raise FixtureError(reason="the rig runs on a VirtualClock")
        self.mgr = mgr
        self.clock: VirtualClock = mgr.clock
        self.state = state
        self._streams = contextlib.ExitStack()
        self._tasks: list[asyncio.Task[None]] = []
        self._readers: list[MeteringReader] = []

    async def until(self, ready: Callable[[], bool]) -> None:
        """Advance poll passes until ``ready`` holds, failing the fixture when ``POLLS`` passes do not get there."""
        for _ in range(POLLS):
            if ready():
                return
            await advanced(self.clock, self.mgr.cfg.poll_interval)
        raise FixtureError(reason="the fakes never reached the state the case arranged")

    async def attach(self, wire_frame: bytes) -> None:
        """Point the manager's reader at a fresh stream of ``wire_frame`` and wait until it has an aggregate."""
        port = self._streams.enter_context(
            fake_network.serving(functools.partial(fake_metering.serve, frame=wire_frame))
        )
        mgr = self.mgr
        reader = MeteringReader(
            "127.0.0.1",
            port,
            lambda: context_from(mgr),
            pace=mgr.clock.pace,
            monotonic=mgr.clock.monotonic,
            opener=fake_network.NETWORK.open_stream,
        )
        mgr.metering = reader
        self._readers.append(reader)
        self._tasks.append(mgr.clock.spawn(reader.run()))
        await self.until(lambda: reader.aggregate() is not None)

    async def engine_plays(self, *, playing: bool) -> None:
        """Move the daemon in or out of playback and wait until the manager's poll has read it."""
        self.state["state"] = PLAYING if playing else STOPPED
        await self.until(lambda: (ctx := context_from(self.mgr)) is not None and ctx.playing is playing)

    async def track_rate(self, samplerate: int) -> None:
        """Move the daemon to a track at ``samplerate`` and wait until the manager's poll has read it."""
        self.state["_metadata"] = metadata(samplerate)
        await self.until(lambda: (ctx := context_from(self.mgr)) is not None and ctx.samplerate == samplerate)

    def start_capture(self, dest: Path) -> asyncio.Task[None]:
        """Run ``junkcal.run`` on the manager's clock into ``dest``, to be cancelled with the rig."""
        task = self.mgr.clock.spawn(junkcal.run(self.mgr, dest))
        self._tasks.append(task)
        return task

    async def close(self) -> None:
        """Stop every reader, cancel every task started, and hang up every stream."""
        for reader in self._readers:
            reader.stop()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._streams.close()
