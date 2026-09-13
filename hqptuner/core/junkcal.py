"""Calibration capture for the junk-filter detector: what it saw, one row per tick, one file per playback period.

An operator's tool, off unless ``Config.junkcal_dir`` names a directory. A background task of its own, started by the
app lifespan beside auto-pilot and only where the metering reader runs. It reads and writes files only: nothing here
talks to the engine, engages a filter or touches the reader's lifetime.

While the detector's eligibility gate passes, each tick appends one JSON Lines row: the live verdict, the junk
filter auto-pilot resolves from it, the engine context, the aggregate's coverage and grid, and the windowed minimum
spectrum at or above ``SPECTRUM_FLOOR_HZ``. The spectrum is the metering tap's own, which sees the source rate.

A playback period is one file. The aggregate restarts with every stream the player opens, so a period is held open
across short silence and closes only on a gap of ``PERIOD_GAP_SECONDS`` without playback, a samplerate change, or a
change of bin grid. A file write that fails is logged and the loop keeps ticking.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from hqptuner.engine import junkadvisor
from hqptuner.engine.metering import context_from
from hqptuner.lanes import autopilot

if TYPE_CHECKING:
    from pathlib import Path

    from hqptuner.core.manager import ConnectionManager
    from hqptuner.engine.metering import SpectralAggregate

log = logging.getLogger(__name__)

TICK_SECONDS = 15.0
PERIOD_GAP_SECONDS = 60.0
# How much of the curve a row stores. Not a detector threshold — no rule reads
# it — just the point below which a capture carries nothing worth keeping.
SPECTRUM_FLOOR_HZ = 13_000.0


def _spectrum(agg: SpectralAggregate) -> list[list[float]] | None:
    """Return the windowed minimum as ``[hz, db]`` pairs at or above ``SPECTRUM_FLOOR_HZ``, or None until earned."""
    window = agg.window_min_db()
    if window is None:
        return None
    pairs = ([junkadvisor.hz(i, agg.bins, agg.bandwidth), db] for i, db in enumerate(window))
    return [pair for pair in pairs if pair[0] >= SPECTRUM_FLOOR_HZ]


def _row(mgr: ConnectionManager) -> dict[str, Any] | None:
    """Return this tick's row, an empty row while playing ineligible content, or None when nothing is playing."""
    reader = mgr.metering
    ctx = context_from(mgr)
    agg = reader.aggregate() if reader is not None else None
    if reader is None or ctx is None or not ctx.playing or agg is None:
        return None
    if not junkadvisor.eligible(ctx.samplerate, agg.bandwidth, agg.bins, sdm=ctx.sdm):
        return {}
    verdict = reader.verdict()
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "verdict": verdict,
        "desired_junk_filter": autopilot.desired_junk_filter(verdict, ctx.filter),
        "junk_filter": ctx.junk_filter,
        "filter": ctx.filter,
        "samplerate": ctx.samplerate,
        "seconds": agg.seconds,
        "frames": agg.frames,
        "bandwidth": agg.bandwidth,
        "bins": agg.bins,
        "spectrum": _spectrum(agg),
    }


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

    def _append(self, row: dict[str, Any]) -> None:
        if self._path is None:
            self._path = _claim(self._dest, datetime.fromisoformat(row["timestamp"]))
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")

    async def tick(self, mgr: ConnectionManager) -> None:
        """Capture once: close the period where it has ended, then append this tick's row where one is due.

        Every call counts as ``TICK_SECONDS`` toward the playback gap, so the gap is measured in ticks, not wall time.
        """
        row = _row(mgr)
        if row is None:
            self._idle += TICK_SECONDS
            if self._idle >= PERIOD_GAP_SECONDS:
                self._path = None
            return
        self._idle = 0.0
        if not row:
            return
        key = (row["samplerate"], row["bins"], row["bandwidth"])
        if key != self._key:
            self._path, self._key = None, key
        try:
            await asyncio.to_thread(self._append, row)
        except OSError as exc:
            log.warning("junkcal capture write failed: %s", exc)


async def run(mgr: ConnectionManager, dest: Path) -> None:
    """Capture once per tick until the task is cancelled, which is how the lifespan stops it.

    The wait is the manager's own, which the test suite virtualizes (``docs/testing.md`` §7).
    """
    capture = Capture(dest)
    while True:
        await capture.tick(mgr)
        await mgr.sleep(TICK_SECONDS)
