"""Capture what port 4322 sends around a track start, with the arrival time of every frame beside its stamp.

Read-only toward hqplayerd. It opens one bare TCP connection to the metering port, the way
``probe_metering_stream.py`` and ``scripts/junkcal/junkcal_burst.py`` do, with no control-channel command, and one
control connection that sends nothing but ``<Status subscribe="0"/>`` reads. It holds no second metering connection
at any time, writes nothing to the daemon and sends no transport command. The listener starts the music.

Frames are read with the header struct and the payload sizing ``MeteringReader`` uses. Each one goes through the
repo's own ``reduce_frame`` and ``MeterFeed`` (``hqptuner/engine/meterfeed.py``), on a subscriber this script attaches
and drains, so the ``at`` and ``n`` stamps in the capture are the ones a page gets. A stamp counts metered samples
from the moment its connection opened, ``bins - 1`` a frame, and ``MeterFeed.reset`` runs on every connect as the
repo's reader does.

The run records, all in wall ms from the run's start on one monotonic clock:

* ``frames``: every frame's arrival ``t_ms``, its connection number, ``fed`` (the metered samples counted through that
  frame since its connection opened) and its header geometry (channels, bins, bandwidth, transform time);
* ``events``: every ``geometry`` event, and every ``frame`` event as ``at`` and ``n`` alone, each with the arrival of
  the frame that completed it;
* ``connections``: every connect, end of stream and refused connect; after an end or a refusal the script waits
  ``RECONNECT_DELAY`` before the next connect;
* ``status``: a ``get_status`` sample every ``STATUS_INTERVAL_S``, with the attributes as the read returned them and
  the metadata ``samplerate``.

Two modes. ``held`` connects at once and keeps the connection through whatever starts the listener makes. ``late``
holds no metering connection until Status shows a start (``state`` turns to playing, or ``track_serial`` changes
while playing) and then connects ``--connect-after`` seconds after that Status sample.

Each run is appended to the output file's list of runs. ``owner_spectrum_offset_s`` is the spectrum offset the
owner's page shows, in seconds, which only the owner can read; it is recorded so a replay can run at the page's
effective delay (``hqptuner/static/store/meter/delay.js``).

Usage:
    capture_meter_start.py held <window-s> <spectrum-offset-s> [--out PATH]
    capture_meter_start.py late <window-s> <spectrum-offset-s> --connect-after S [--out PATH]
"""

import argparse
import asyncio
import contextlib
import json
import signal
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from hqptuner.config import Config
from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.meterfeed import MeterFeed, reduce_frame
from hqptuner.engine.metering import IDLE_RECHECK, RECONNECT_DELAY, read_frame
from hqptuner.engine.trackcontext import PLAYING

SCHEMA = "meter_start_capture/1"
DEFAULT_OUT = Path(tempfile.gettempdir()) / "meter_start_capture.json"

#: How often Status is sampled: five times the app's own 1 s status cadence, so the probe adds little load. It also
#: bounds how precisely a start can be timed.
STATUS_INTERVAL_S = 0.2

Record = dict[str, Any]
Frame = tuple[tuple[float, ...], bytes]


@dataclass
class Run:
    """Everything one run records, filled in as it goes so an interrupted run still keeps what it saw."""

    started: float = field(default_factory=time.monotonic)
    frames: list[Record] = field(default_factory=list)
    events: list[Record] = field(default_factory=list)
    connections: list[Record] = field(default_factory=list)
    status: list[Record] = field(default_factory=list)
    start_sample_ms: float | None = None
    start_reason: str | None = None
    ended: str = "window"

    def ms(self) -> float:
        """Return wall ms since the run began, on the monotonic clock."""
        return round((time.monotonic() - self.started) * 1000.0, 3)


def _int(value: str | None) -> int | None:
    """Parse a Status attribute as an integer; None where it is absent or not one."""
    return int(value) if value is not None and value.lstrip("-").isdigit() else None


def parse_sse(text: str) -> tuple[str, Any]:
    """Return the event name and decoded data of one ``MeterFeed`` event text."""
    name = ""
    data = ""
    for line in text.split("\n"):
        key, _, value = line.partition(": ")
        if key == "event":
            name = value
        elif key == "data":
            data = value
    return name, json.loads(data)


class Tap:
    """The run's one ``MeterFeed`` and the subscriber this script attaches to it and drains itself."""

    def __init__(self, run: Run) -> None:
        """Attach the subscriber; without one ``MeterFeed.add`` folds nothing."""
        self.run = run
        self.feed = MeterFeed()
        self.queue = self.feed.subscribe()

    def log_frame(self, conn: int, fed: int, frame: Frame) -> None:
        """Record one arrived frame and every feed event it completed, all stamped with the one arrival time."""
        t_ms = self.run.ms()
        header, body = frame
        channels, bins = int(header[1]), int(header[2])
        self.run.frames.append(
            {
                "t_ms": t_ms,
                "conn": conn,
                "fed": fed,
                "channels": channels,
                "bins": bins,
                "bandwidth": header[4],
                "xform_time": header[5],
            }
        )
        self.feed.add(header, reduce_frame(body, channels, bins))
        while not self.queue.empty():
            name, data = parse_sse(self.queue.get_nowait())
            kept = data if name == "geometry" else {"at": data["at"], "n": data["n"]}
            self.run.events.append({"t_ms": t_ms, "conn": conn, "event": name, "data": kept})


async def stream(tap: Tap, cfg: Config, conn: int) -> None:
    """Hold one metering connection, logging every frame, until it breaks or the run is canceled."""
    run = tap.run
    try:
        async with asyncio.timeout(cfg.request_timeout):
            reader, writer = await asyncio.open_connection(cfg.hqp_host, cfg.hqp_metering_port)
    except (OSError, TimeoutError) as exc:
        run.connections.append({"t_ms": run.ms(), "conn": conn, "kind": "refused", "detail": repr(exc)})
        return
    tap.feed.reset()
    run.connections.append({"t_ms": run.ms(), "conn": conn, "kind": "connect", "detail": None})
    fed = 0
    try:
        while True:
            frame = await read_frame(reader)
            fed += int(frame[0][2]) - 1
            tap.log_frame(conn, fed, frame)
    except (OSError, asyncio.IncompleteReadError) as exc:
        run.connections.append({"t_ms": run.ms(), "conn": conn, "kind": "end", "detail": repr(exc)})
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()


async def reader_loop(
    run: Run, cfg: Config, start: asyncio.Event, connect_after: float | None, started_at: list[float]
) -> None:
    """Connect when the mode says to, then reconnect after ``RECONNECT_DELAY`` each time a stream ends or is refused."""
    tap = Tap(run)
    if connect_after is not None:
        await start.wait()
        await asyncio.sleep(max(0.0, started_at[0] + connect_after - time.monotonic()))
    conn = 0
    while True:
        conn += 1
        await stream(tap, cfg, conn)
        await asyncio.sleep(RECONNECT_DELAY)


def is_start(prev: dict[str, str] | None, status: dict[str, str]) -> str | None:
    """Name the start this Status sample shows against the one before it, or None."""
    if prev is None or _int(status.get("state")) != PLAYING:
        return None
    if _int(prev.get("state")) != PLAYING:
        return "state-to-playing"
    if status.get("track_serial") != prev.get("track_serial"):
        return "track-serial-change"
    return None


async def sample_status(run: Run, cfg: Config, start: asyncio.Event, started_at: list[float]) -> None:
    """Sample Status every ``STATUS_INTERVAL_S``, the only control command sent, and flag the first start it shows."""
    client = ControlClient(cfg.hqp_host, cfg.hqp_control_port, cfg.request_timeout)
    prev: dict[str, str] | None = None
    up = False
    try:
        while True:
            sent_ms = run.ms()
            try:
                if not up:
                    await client.connect()
                    up = True
                attrs, meta = await client.get_status()
            except (ControlError, OSError, TimeoutError) as exc:
                run.status.append({"sent_ms": sent_ms, "t_ms": run.ms(), "error": repr(exc)})
                await client.close()
                up, prev = False, None
            else:
                reason = is_start(prev, attrs)
                run.status.append(
                    {
                        "sent_ms": sent_ms,
                        "t_ms": run.ms(),
                        "status": attrs,
                        "samplerate": None if meta is None else meta.get("samplerate"),
                    }
                )
                if reason is not None and run.start_sample_ms is None:
                    run.start_sample_ms, run.start_reason = run.ms(), reason
                    started_at[0] = time.monotonic()
                    start.set()
                prev = attrs
            await asyncio.sleep(STATUS_INTERVAL_S)
    finally:
        await client.close()


async def capture(args: argparse.Namespace) -> Run:
    """Run both tasks for the window and return what they recorded."""
    cfg = Config()
    run = Run()
    start = asyncio.Event()
    started_at = [0.0]
    connect_after: float | None = args.connect_after if args.mode == "late" else None
    work = asyncio.gather(
        reader_loop(run, cfg, start, connect_after, started_at),
        sample_status(run, cfg, start, started_at),
    )
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, work.cancel)
    try:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(work, args.window)
    except asyncio.CancelledError:
        run.ended = "interrupted"
    return run


def save(path: Path, args: argparse.Namespace, run: Run) -> None:
    """Append this run to the output file's list of runs."""
    cfg = Config()
    document: Record = {"schema": SCHEMA, "runs": []}
    if path.exists():
        document = json.loads(path.read_text())
    document["runs"].append(
        {
            "mode": args.mode,
            "connect_offset_s": args.connect_after if args.mode == "late" else None,
            "window_s": args.window,
            "ended": run.ended,
            "owner_spectrum_offset_s": args.spectrum_offset,
            "started_utc": datetime.now(UTC).isoformat(),
            "status_interval_s": STATUS_INTERVAL_S,
            "reconnect_delay_s": RECONNECT_DELAY,
            "idle_recheck_s": IDLE_RECHECK,
            "app_poll_interval_s": cfg.poll_interval,
            "app_status_interval_s": cfg.status_interval,
            "start_sample_ms": run.start_sample_ms,
            "start_reason": run.start_reason,
            "connections": run.connections,
            "status": run.status,
            "frames": run.frames,
            "events": run.events,
        }
    )
    path.write_text(json.dumps(document, separators=(",", ":")) + "\n")


def main(argv: list[str]) -> None:
    """Parse the command line, capture one run, append it to the output file and print the counts."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=("held", "late"))
    parser.add_argument("window", type=float, help="run window, seconds")
    parser.add_argument("spectrum_offset", type=float, help="the spectrum offset the owner's page shows, seconds")
    parser.add_argument(
        "--connect-after", type=float, help="late mode: seconds after the Status sample that shows a start"
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="runs file, appended to")
    args = parser.parse_args(argv)
    if args.mode == "late" and args.connect_after is None:
        parser.error("late mode needs --connect-after")
    if args.mode == "held" and args.connect_after is not None:
        parser.error("--connect-after is for late mode")
    run = asyncio.run(capture(args))
    save(args.out, args, run)
    print(
        f"{args.mode} run ended ({run.ended}): {len(run.frames)} frames, {len(run.events)} events, "
        f"{len(run.connections)} connection records, {len(run.status)} status samples -> {args.out}"
    )


if __name__ == "__main__":
    main(sys.argv[1:])
