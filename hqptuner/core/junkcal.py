"""Calibration capture for the junk-filter detector: what it saw, one row per tick, one file per playback period.

An operator's tool, off unless ``Config.junkcal_dir`` names a directory. A background task of its own, started by the
app lifespan beside auto-pilot and only where the metering reader runs. It reads and writes files only: nothing here
talks to the engine, engages a filter or touches the reader's lifetime.

While the detector's eligibility gate passes, each tick appends one JSON Lines row: the live verdict, the junk
filter auto-pilot resolves from it, the engine context, the aggregate's coverage and grid, and the minimum spectrum
over the coverage in hand at or above ``SPECTRUM_FLOOR_HZ`` — a row carries one from the opening seconds of a period,
not only once a full window stands behind it. The spectrum is the metering tap's own, which sees the source rate.

A playback period is one file. The aggregate restarts with every stream the player opens, so a period is held open
across short silence and closes only on a gap of ``PERIOD_GAP_SECONDS`` without playback, a samplerate change, or a
change of bin grid. A file write that fails is logged and the loop keeps ticking.
"""

from __future__ import annotations

import asyncio
import dataclasses
import enum
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from hqptuner.engine import junkadvisor, junkcurve
from hqptuner.engine.trackcontext import context_from
from hqptuner.lanes import autopilot

if TYPE_CHECKING:
    from pathlib import Path

    from hqptuner.core.manager import ConnectionManager
    from hqptuner.engine.metering import MeteringReader, SpectralAggregate
    from hqptuner.engine.trackcontext import TrackContext

log = logging.getLogger(__name__)

TICK_SECONDS = 15.0
PERIOD_GAP_SECONDS = 60.0
# How much of the curve a row stores. Not a detector threshold — no rule reads
# it — just the point below which a capture carries nothing worth keeping.
SPECTRUM_FLOOR_HZ = 13_000.0


def _spectrum(agg: SpectralAggregate) -> list[list[float]] | None:
    """Return the windowed minimum as ``[hz, db]`` pairs at or above ``SPECTRUM_FLOOR_HZ``, or None with no evidence."""
    window = agg.window_min_db()
    if window is None:
        return None
    pairs = ([junkcurve.hz(i, agg.bins, agg.bandwidth), db] for i, db in enumerate(window))
    return [pair for pair in pairs if pair[0] >= SPECTRUM_FLOOR_HZ]


class TickState(enum.Enum):
    """What a tick's playback state has to say about capturing it."""

    IDLE = "idle"
    INELIGIBLE = "ineligible"
    CAPTURE = "capture"


def tick_state(samplerate: int | None, bandwidth: float, bins: int, *, sdm: bool) -> TickState:
    """Whether this playing tick's spectrum carries enough to capture, given ``junkadvisor.eligible``."""
    if junkadvisor.eligible(samplerate, bandwidth, bins, sdm=sdm):
        return TickState.CAPTURE
    return TickState.INELIGIBLE


@dataclass(frozen=True)
class CalRow:
    """One capture tick, ready to append as one line of JSON."""

    timestamp: str
    verdict: junkadvisor.JunkVerdict | None
    desired_junk_filter: str
    junk_filter: str | None
    filter: str | None
    samplerate: int | None
    seconds: float
    frames: int
    bandwidth: float
    bins: int
    spectrum: list[list[float]] | None


def _build_row(reader: MeteringReader, ctx: TrackContext, agg: SpectralAggregate) -> CalRow:
    """Build this tick's row from an already-eligible reading."""
    verdict = reader.verdict()
    return CalRow(
        timestamp=datetime.now(UTC).isoformat(),
        verdict=verdict,
        desired_junk_filter=autopilot.desired_junk_filter(verdict, ctx.filter),
        junk_filter=ctx.junk_filter,
        filter=ctx.filter,
        samplerate=ctx.samplerate,
        seconds=agg.seconds,
        frames=agg.frames,
        bandwidth=agg.bandwidth,
        bins=agg.bins,
        spectrum=_spectrum(agg),
    )


def _claim(dest: Path, started: datetime) -> Path:
    """Create and return a new period file named for its first row's UTC time, never reusing an existing name."""
    dest.mkdir(parents=True, exist_ok=True)
    stem = f"junkcal-{started:%Y%m%dT%H%M%SZ}"
    n = 1
    while True:
        path = dest / (f"{stem}.jsonl" if n == 1 else f"{stem}-{n}.jsonl")
        try:
            path.touch(exist_ok=False)
        except FileExistsError:
            n += 1
            continue
        return path


class Capture:
    """One destination directory and the playback period currently being written into it."""

    def __init__(self, dest: Path) -> None:
        """Hold the destination; no file exists until the first eligible tick."""
        self._dest = dest
        self._path: Path | None = None
        self._key: tuple[int | None, int, float] | None = None
        self._idle = 0.0

    def _append(self, row: CalRow) -> None:
        if self._path is None:
            self._path = _claim(self._dest, datetime.fromisoformat(row.timestamp))
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(dataclasses.asdict(row)) + "\n")

    async def tick(self, mgr: ConnectionManager) -> None:
        """Capture once: close the period where it has ended, then append this tick's row where one is due.

        Every call counts as ``TICK_SECONDS`` toward the playback gap, so the gap is measured in ticks, not wall time.
        """
        reader = mgr.metering
        ctx = context_from(mgr)
        agg = reader.aggregate() if reader is not None else None
        if reader is None or ctx is None or not ctx.playing or agg is None:
            self._idle += TICK_SECONDS
            if self._idle >= PERIOD_GAP_SECONDS:
                self._path = None
            return
        self._idle = 0.0
        if tick_state(ctx.samplerate, agg.bandwidth, agg.bins, sdm=ctx.sdm) is TickState.INELIGIBLE:
            return
        row = _build_row(reader, ctx, agg)
        key = (row.samplerate, row.bins, row.bandwidth)
        if key != self._key:
            self._path, self._key = None, key
        try:
            await asyncio.to_thread(self._append, row)
        except OSError as exc:
            log.warning("junkcal capture write failed: %s", exc)


async def run(mgr: ConnectionManager, dest: Path) -> None:
    """Capture once per tick until the task is cancelled, which is how the lifespan stops it.

    The wait is the manager clock's background wait.
    """
    capture = Capture(dest)
    while True:
        await capture.tick(mgr)
        await mgr.clock.pace(None, TICK_SECONDS)
