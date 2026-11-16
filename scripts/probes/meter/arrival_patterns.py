"""Print how data arrives around a track start, from one ``capture_meter_start.py`` fixture.

Read-only: it opens the fixture file named on the command line and nothing else. No connection, no write, no output
file. Run it as ``.venv/bin/python -I scripts/probes/meter/arrival_patterns.py <fixture.json>``.

The definitions are ``.planning/phases/7/CAPTURE.md``'s. The stamp lead of a frame is the playback ms the stamps have
counted through it, minus its arrival wall ms. Playback ms per frame is ``(bins - 1) / rate * 1000`` with ``rate`` the
metering rate the frame's own header implies, ``round((bins - 1) / xform_time)``. A positive lead means the stamps run
ahead of wall time. A track start is a change of Status ``track_serial``. Status ``position`` is read here only for
when a track is first heard and that it advances at wall speed; it is never fitted and never read as a clock.

Per start it prints the frame gaps over 250 ms within 3 s of the serial change and the shift in median lead, the
opening rush after each stretch with no frames and after a first frame near it, and the Status shape around the
change. The app's reader is read from ``run`` and ``_stream`` in ``hqptuner/engine/metering.py`` and ``_rest`` in
``hqptuner/core/loader.py``: it is connected only while the manager's last Status read shows playing and a subscriber
is attached, checks State at each frame and each ``IDLE_RECHECK``, and waits ``IDLE_RECHECK`` after letting go before
it checks again.

Then the drift in each steady stretch and the capture's ``output_delay`` per rate.
"""

import bisect
import itertools
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Record = dict[str, Any]

PLAYING = "2"
#: A stretch with no frames this long is a stop; CAPTURE.md block B.
RESUME_GAP_MS = 500.0
#: A frame gap this long near a serial change is reported; CAPTURE.md block C.
NOTABLE_GAP_MS = 250.0
NEAR_MS = 3000.0
#: A Status reply this slow is reported; ``t_ms`` less ``sent_ms``.
SLOW_READ_MS = 500.0
#: Bins and the post-resume skip for the steady stretches; CAPTURE.md block F.
BIN_MS = 10000.0
#: The mean lead after a resume is read over +5 to +9 s; CAPTURE.md block B.
STEADY_FROM_MS = 5000.0
STEADY_TO_MS = 9000.0
#: A figure needs two samples (or two bins) before it is a change.
TWO = 2
SKIP_AFTER_RESUME_MS = 3000.0
#: The first capture's own block F windows, printed only where this geometry sequence matches it.
CAPTURE_1_GEOMETRY = [(143.5, 44100), (37312.6, 96000), (126210.0, 44100)]
CAPTURE_1_F_WINDOWS = [
    ("44100, 0-30 s", 0, 20000),
    ("96000, 50-120 s", 50000, 110000),
    ("44100, 130-300 s", 130000, 280000),
]
BLOCK_A_BACK_MS = 5000.0
BLOCK_A_AFTER_MS = [(0, 300), (300, 1000), (1000, 5000), (5000, 10000)]


@dataclass
class Capture:
    """One run's frames as parallel arrays, with the playback ms the stamps count through each frame."""

    run: Record
    t: list[float]
    pb: list[float]
    rate: list[int]
    frame_ms: list[float]
    status: list[Record]
    geometry: list[tuple[float, int]]
    stamp_break_ms: list[float]

    def lead(self, i: int) -> float:
        """Return the stamp lead of frame ``i``, playback ms less arrival wall ms."""
        return self.pb[i] - self.t[i]


def load(path: Path) -> Capture:
    """Read the fixture's one run and derive the per-frame playback ms."""
    document = json.loads(path.read_text())
    run: Record = document["runs"][0]
    t: list[float] = []
    pb: list[float] = []
    rate: list[int] = []
    frame_ms: list[float] = []
    total = 0.0
    for frame in run["frames"]:
        hz = round((frame["bins"] - 1) / frame["xform_time"])
        step = (frame["bins"] - 1) / hz * 1000.0
        total += step
        t.append(frame["t_ms"])
        pb.append(total)
        rate.append(hz)
        frame_ms.append(step)
    events = [e for e in run["events"] if e["event"] == "frame"]
    breaks = [b["t_ms"] for a, b in itertools.pairwise(events) if b["data"]["at"] != a["data"]["at"] + a["data"]["n"]]
    geometry = [(e["t_ms"], e["data"]["rate"]) for e in run["events"] if e["event"] == "geometry"]
    status = [s for s in run["status"] if "status" in s]
    return Capture(run, t, pb, rate, frame_ms, status, geometry, breaks)


def serial_changes(cap: Capture) -> list[tuple[int, Record]]:
    """Return ``(index, sample)`` for each Status sample whose ``track_serial`` differs from the sample before it."""
    return [
        (k, cap.status[k])
        for k in range(1, len(cap.status))
        if cap.status[k]["status"]["track_serial"] != cap.status[k - 1]["status"]["track_serial"]
    ]


def resumes(cap: Capture) -> list[int]:
    """Return the index of the first frame after each stretch with no frames over ``RESUME_GAP_MS``."""
    return [k for k in range(1, len(cap.t)) if cap.t[k] - cap.t[k - 1] > RESUME_GAP_MS]


def median_lead(cap: Capture, lo: float, hi: float) -> tuple[float, float, int] | None:
    """Return the median lead, its spread and the frame count over arrivals in ``[lo, hi)``, or None if empty."""
    values = sorted(cap.lead(i) for i in range(len(cap.t)) if lo <= cap.t[i] < hi)
    if not values:
        return None
    return values[len(values) // 2], values[-1] - values[0], len(values)


def lead_at(cap: Capture, base: float, t0: float, dt: float) -> float:
    """Return the lead from the resume (baseline ``base``, first frame at ``t0``) at ``dt`` ms after its first frame."""
    j = bisect.bisect_right(cap.t, t0 + dt) - 1
    return cap.pb[j] - base - (cap.t[j] - t0)


def print_rush(cap: Capture, i: int) -> None:
    """Print the opening rush after the resume at frame ``i``: CAPTURE.md block B."""
    t0 = cap.t[i]
    base = cap.pb[i] - cap.frame_ms[i]
    print(f"  resume t={t0:.0f} ms rate={cap.rate[i]} {f'gap={t0 - cap.t[i - 1]:.0f} ms' if i else 'first frame'}")
    print(
        "    lead at +0,100,200,300,500,1000 ms:",
        [round(lead_at(cap, base, t0, d)) for d in (0, 100, 200, 300, 500, 1000)],
    )
    steady = [
        cap.pb[j] - base - (cap.t[j] - t0)
        for j in range(i, len(cap.t))
        if STEADY_FROM_MS <= cap.t[j] - t0 < STEADY_TO_MS
    ]
    if not steady:
        print("    no frames in +5..+9 s: mean lead not measured")
        return
    mean = sum(steady) / len(steady)
    reach = next(cap.t[j] - t0 for j in range(i, len(cap.t)) if cap.pb[j] - base - (cap.t[j] - t0) >= mean - 50)
    print(f"    mean lead +5..+9 s: {mean:.0f} ms; first within 50 ms of it at +{reach:.0f} ms")
    for window in (300, 1000):
        count = bisect.bisect_right(cap.t, t0 + window) - i
        print(f"    frames in first {window} ms: {count}, real time would be {window / 1000 * cap.rate[i] / 1024:.1f}")


def print_median_shift(cap: Capture, t0: float, lo_edge: float, hi_edge: float) -> None:
    """Print median lead after a start against the 5 s before it: CAPTURE.md block A, windows clipped to ``edges``."""
    base = median_lead(cap, max(lo_edge, t0 - BLOCK_A_BACK_MS), t0)
    if base is None:
        print("    no frames before the start: median lead shift not measured")
        return
    print(f"    median lead before {base[0]:.0f} ms (spread {base[1]:.0f}, {base[2]} frames)")
    for a, b in BLOCK_A_AFTER_MS:
        m = median_lead(cap, t0 + a, min(t0 + b, hi_edge))
        shown = (
            "no frames" if m is None else f"{m[0] - base[0]:+.0f} ms against before (spread {m[1]:.0f}, {m[2]} frames)"
        )
        print(f"    +{a}..+{b} ms: median lead {shown}")


def gaps_near(cap: Capture, t0: float) -> list[tuple[int, float, float]]:
    """Return ``(frame index, start ms, length ms)`` for each frame gap over ``NOTABLE_GAP_MS`` within 3 s of ``t0``."""
    return [
        (k, cap.t[k - 1], cap.t[k] - cap.t[k - 1])
        for k in range(1, len(cap.t))
        if abs(cap.t[k] - t0) < NEAR_MS and cap.t[k] - cap.t[k - 1] > NOTABLE_GAP_MS
    ]


def not_playing_stretches(cap: Capture, t0: float) -> list[tuple[float, float, str]]:
    """Return ``(first sample ms, length ms, state)`` of each run of non-playing samples within 3 s of ``t0``.

    The length runs from the first non-playing sample to the first playing sample after it, so it carries the
    sample grain of ``status_interval_s``.
    """
    out: list[tuple[float, float, str]] = []
    k = 0
    near = [s for s in cap.status if abs(s["t_ms"] - t0) <= NEAR_MS]
    while k < len(near):
        if near[k]["status"]["state"] != PLAYING:
            m = k
            while m < len(near) and near[m]["status"]["state"] != PLAYING:
                m += 1
            end = near[m]["t_ms"] if m < len(near) else near[-1]["t_ms"]
            out.append((near[k]["t_ms"], end - near[k]["t_ms"], near[k]["status"]["state"]))
            k = m
        else:
            k += 1
    return out


def print_gaps(cap: Capture, t0: float) -> None:
    """Print each notable frame gap near ``t0`` and what follows it: CAPTURE.md blocks C and A."""
    gaps = gaps_near(cap, t0)
    if not gaps:
        print("  frame gaps over 250 ms within 3 s: none")
    for k, start, length in gaps:
        end = cap.t[k]
        geo = [hz for t, hz in cap.geometry if abs(t - end) < 1.0]
        brk = [t for t in cap.stamp_break_ms if abs(t - end) < 1.0]
        print(
            f"  frame gap over 250 ms: start {start:.0f} ms, {length:.0f} ms long, geometry event after it: "
            f"{geo[0] if geo else 'none'}, stamp break after it: {'yes' if brk else 'no'}"
        )


def print_reader(cap: Capture, t0: float) -> None:
    """Print the Status shape near ``t0`` and what the app's reader does there, from the code and the run's knobs."""
    run = cap.run
    interval = float(run["app_status_interval_s"]) * 1000.0
    recheck = float(run["idle_recheck_s"]) * 1000.0
    stretches = not_playing_stretches(cap, t0)
    near = [s for s in cap.status if abs(s["t_ms"] - t0) <= NEAR_MS]
    slow = [
        (round(s["sent_ms"]), round(s["t_ms"] - s["sent_ms"])) for s in near if s["t_ms"] - s["sent_ms"] > SLOW_READ_MS
    ]
    states = sorted({s["status"]["state"] for s in near})
    print(f"  Status within 3 s: states {states}, reads over 500 ms (sent ms, reply ms): {slow}")
    if not stretches:
        print("  State not playing: no stretch; the app's reader holds its connection through this start")
        return
    for first, length, state in stretches:
        seen = min(1.0, length / interval)
        print(f"  State {state}, not playing from {first:.0f} ms for {length:.0f} ms")
        end = first + length
        late = interval + recheck
        print(
            f"    app's reader: a manager read lands in the stretch with chance {seen:.2f} "
            f"(one read each {interval:.0f} ms) and then drops; it rejoins at its first check after the manager "
            f"shows playing, {end:.0f} to {end + late:.0f} ms wall "
            f"(0 to {late / 1000:.1f} s after Status shows playing)"
        )


def print_start(cap: Capture, k: int, sample: Record, edges: tuple[float, float]) -> None:
    """Print every pattern near one serial change."""
    t0 = sample["t_ms"]
    now, before = sample["status"], cap.status[k - 1]
    print(
        f"serial {before['status']['track_serial']}->{now['track_serial']} at {t0:.0f} ms: "
        f"state {before['status']['state']}->{now['state']}, samplerate {before['samplerate']}->{sample['samplerate']}"
    )
    print_gaps(cap, t0)
    near_resumes = [i for i in [0, *resumes(cap)] if abs(cap.t[i] - t0) < NEAR_MS]
    for i in near_resumes:
        print_rush(cap, i)
    if not near_resumes:
        print("  no stretch with no frames over 500 ms within 3 s: median lead against the 5 s before")
        print_median_shift(cap, t0, edges[0], edges[1])
    move = next(
        (
            x["t_ms"]
            for x in cap.status
            if x["t_ms"] >= t0
            and x["status"]["track_serial"] == now["track_serial"]
            and float(x["status"]["position"]) > 0
        ),
        None,
    )
    print("  position first above 0 after:", "never" if move is None else f"{move - t0:.0f} ms")
    print_reader(cap, t0)


def position_moves(cap: Capture) -> dict[float, int]:
    """Count the moves of ``position``, in ms rounded to 0.1, between consecutive playing samples of one serial."""
    moves: dict[float, int] = {}
    for a, b in itertools.pairwise(cap.status):
        if (
            a["status"]["track_serial"] == b["status"]["track_serial"]
            and a["status"]["state"] == b["status"]["state"] == PLAYING
        ):
            move = round((float(b["status"]["position"]) - float(a["status"]["position"])) * 1000.0, 1)
            moves[move] = moves.get(move, 0) + 1
    return dict(sorted(moves.items()))


def stretches(cap: Capture) -> list[tuple[int, int]]:
    """Return ``(first, last)`` frame indexes of each run of frames with no gap over ``RESUME_GAP_MS``."""
    cuts = [0, *resumes(cap), len(cap.t)]
    return [(a, b - 1) for a, b in itertools.pairwise(cuts)]


def bin_lead(cap: Capture, lo: float) -> float:
    """Return the mean lead over arrivals in the 10 s bin starting at ``lo``."""
    values = [cap.lead(i) for i in range(len(cap.t)) if lo <= cap.t[i] < lo + BIN_MS]
    return sum(values) / len(values)


def bin_ratio(cap: Capture, lo: float) -> float:
    """Return stamp ms per wall ms over the 10 s bin starting at ``lo``, last frame at or before each end."""
    a = max(bisect.bisect_right(cap.t, lo) - 1, 0)
    b = bisect.bisect_right(cap.t, lo + BIN_MS) - 1
    return (cap.pb[b] - cap.pb[a]) / (cap.t[b] - cap.t[a])


def position_rates(cap: Capture, lo: float, hi: float) -> list[str]:
    """Return per serial: the wall bounds and position seconds per wall second, first to last playing sample."""
    by_serial: dict[str, list[Record]] = {}
    for s in cap.status:
        if lo <= s["t_ms"] <= hi and s["status"]["state"] == PLAYING and float(s["status"]["position"]) > 0:
            by_serial.setdefault(s["status"]["track_serial"], []).append(s)
    rows: list[str] = []
    for serial, rows_of in by_serial.items():
        if len(rows_of) < TWO or rows_of[-1]["t_ms"] == rows_of[0]["t_ms"]:
            continue
        first, last = rows_of[0], rows_of[-1]
        speed = (float(last["status"]["position"]) - float(first["status"]["position"])) / (
            (last["t_ms"] - first["t_ms"]) / 1000.0
        )
        rows.append(f"serial {serial} {first['t_ms']:.0f}-{last['t_ms']:.0f} ms: {speed:.4f}")
    return rows


def drift_row(cap: Capture, name: str, first: float, last: float) -> None:
    """Print the change in mean lead from the first to the last bin: CAPTURE.md block F."""
    ratios = [bin_ratio(cap, lo) for lo in range(int(first), int(last) + 1, int(BIN_MS))]
    change = bin_lead(cap, last) - bin_lead(cap, first)
    print(
        f"  {name}: mean lead in first bin {bin_lead(cap, first):.0f} ms, in last bin {bin_lead(cap, last):.0f} ms, "
        f"change {change:+.0f} ms; stamp ms per wall ms over 10 s: {min(ratios):.3f} to {max(ratios):.3f}"
    )


def print_drift(cap: Capture) -> None:
    """Print the drift of each steady stretch: first and last full 10 s bin, and position's speed over the stretch."""
    print("steady stretches (no stretch with no frames inside; 10 s bins, none begun within 3 s of a resume):")
    for n, (a, b) in enumerate(stretches(cap)):
        lo, hi = cap.t[a], cap.t[b]
        # the first stretch counts the bin its first frame falls in, and no bin that ends before that frame
        floor = lo + SKIP_AFTER_RESUME_MS if n else max(0.0, lo - BIN_MS)
        starts = [
            k * BIN_MS
            for k in range(int(floor // BIN_MS), int(hi // BIN_MS) + 1)
            if k * BIN_MS >= floor and (k + 1) * BIN_MS <= hi
        ]
        rate = cap.rate[a]
        print(f" stretch {lo:.0f}-{hi:.0f} ms at {rate}:")
        if len(starts) < TWO:
            print("  fewer than two full 10 s bins: drift not measured")
        else:
            drift_row(
                cap, f"{rate}, bins {starts[0] / 1000:.0f}-{(starts[-1] + BIN_MS) / 1000:.0f} s", starts[0], starts[-1]
            )
        print("  position seconds per wall second:", position_rates(cap, lo, hi))
    if cap.geometry[: len(CAPTURE_1_GEOMETRY)] == CAPTURE_1_GEOMETRY:
        print("block F's own windows (first capture):")
        for name, first, last in CAPTURE_1_F_WINDOWS:
            drift_row(cap, name, first, last)


def print_output_delay(cap: Capture) -> None:
    """Print ``output_delay`` by Status samplerate while playing: CAPTURE.md block E."""
    counts: dict[Any, dict[str, int]] = {}
    for s in cap.status:
        if s["status"]["state"] == PLAYING:
            row = counts.setdefault(s["samplerate"], {})
            row[s["status"]["output_delay"]] = row.get(s["status"]["output_delay"], 0) + 1
    print("output_delay by Status samplerate while playing (us):", counts)
    print("moves of position between consecutive playing samples of one serial (ms: count):", position_moves(cap))
    print("Status reads over 500 ms in the run:", sum(1 for s in cap.status if s["t_ms"] - s["sent_ms"] > SLOW_READ_MS))


def print_summary(cap: Capture) -> None:
    """Print the connection, geometry and stamp-break rows: CAPTURE.md block C."""
    run = cap.run
    print("connections:", [(c["kind"], round(c["t_ms"], 1)) for c in run["connections"]])
    print("geometry events:", [(round(t, 1), hz) for t, hz in cap.geometry])
    print("frames per rate:", {hz: cap.rate.count(hz) for hz in sorted(set(cap.rate))})
    print("stamp breaks:", len(cap.stamp_break_ms))
    print(f"mode {run['mode']}, ended {run['ended']}, {len(cap.t)} frames, {len(cap.status)} Status samples")
    print(f"app knobs: status_interval {run['app_status_interval_s']} s, IDLE_RECHECK {run['idle_recheck_s']} s")


def main(argv: list[str]) -> int:
    """Print every pattern for the fixture named in ``argv``."""
    if len(argv) != 1:
        print(__doc__)
        return 2
    cap = load(Path(argv[0]))
    print_summary(cap)
    changes = serial_changes(cap)
    for n, (k, sample) in enumerate(changes):
        lo = changes[n - 1][1]["t_ms"] if n else 0.0
        hi = changes[n + 1][1]["t_ms"] if n + 1 < len(changes) else float("inf")
        print_start(cap, k, sample, (lo, hi))
    print_drift(cap)
    print_output_delay(cap)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
