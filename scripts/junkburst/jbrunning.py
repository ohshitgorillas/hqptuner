"""Two running readings kept together over every raw frame of the labelled corpus, from a burst's first frame on.

The pair is swept over a step cut, a warm-up and a named/unnamed break cut pairing.

Per raw frame, on the raw frame alone, the per-frame step and its candidate frequency are read from a 19.5 to
24.5 kHz sweep in 250 Hz steps: at each swept frequency, the median of the 1 kHz band ending there minus the
median of the 1 kHz band starting there, the largest such fall across the sweep winning. A frame names its
candidate when that step reaches a step cut swept at 10, 12 and 14 dB.

From the same first frame, a per-bin cumulative mean is kept over every raw frame seen so far. Its 9-bin smooth
is swept the same way to pick its own candidate, the largest fall winning again. Three least-squares slopes in
dB per kHz are read there off that smooth, each fit dropping its own band's 3 highest-dB bins: ``below`` over the
2 kHz ending 500 Hz under the candidate, ``across`` over the 1 kHz centred on it, ``above`` over the 2 kHz
starting 500 Hz over it. ``break`` is the smaller of ``below`` minus ``across`` and ``above`` minus ``across``.

The burst engages at the first frame at or after a warm-up, swept at 0.25, 0.5 and 1 s, where ``break`` reaches
the named cut, swept at 2, 4 and 8 dB/kHz, if any earlier frame named a candidate within 500 Hz of the mean's own
candidate at that frame, or the unnamed cut, swept at 8, 12 and 20 dB/kHz, otherwise. A burst is real when 5 s
pass since its first frame without engaging, and unresolved when the burst's own frames run out first.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbcurves import Grid, content_curves, median_smooth, musical_frames
from jbderived import load_burst, musical_groups, summed_db
from jbframeonlyscore import PLATEAU_SMOOTH_BINS, _band_slope, _median_band, _steady_bursts

#: Where the report is written, and the command that writes it.
REPORT = Path(__file__).resolve().parents[2] / ".junkburst-report-running.md"
RUN_CMD = "PYTHONPATH=$(pwd) nice -n 10 .venv/bin/python scripts/junkburst/jbrunning.py"

#: The per-frame step sweep: 19.5 to 24.5 kHz in 250 Hz steps, each candidate's own 1 kHz band either side of it.
STEP_SWEEP_HZ = tuple(19_500.0 + 250.0 * i for i in range(21))
STEP_BAND_HZ = 1_000.0

#: The step cut a per-frame step must reach to name its candidate, swept.
STEP_CUTS = (10.0, 12.0, 14.0)

#: The warm-ups swept: no break is read from the cumulative mean before this long since the burst's first frame.
WARMUP_S = (0.25, 0.5, 1.0)

#: The break cut swept when an earlier frame has named a candidate within reach of the mean's own, and when not.
NAMED_CUTS = (2.0, 4.0, 8.0)
UNNAMED_CUTS = (8.0, 12.0, 20.0)

#: One sweep point: step cut, warm-up, named cut, unnamed cut. ``SWEEP`` walks them in that nesting order.
Point = tuple[float, float, float, float]
SWEEP: tuple[Point, ...] = tuple(
    (step_cut, warmup_s, named_cut, unnamed_cut)
    for step_cut in STEP_CUTS
    for warmup_s in WARMUP_S
    for named_cut in NAMED_CUTS
    for unnamed_cut in UNNAMED_CUTS
)

#: How close a per-frame candidate must sit to the mean's own candidate to count as the same one.
CANDIDATE_MATCH_HZ = 500.0

#: The three slope bands read off the cumulative mean's smooth, placed around its own candidate.
SLOPE_GAP_HZ = 500.0
SLOPE_SPAN_HZ = 2_000.0
ACROSS_HALF_HZ = 500.0

#: A burst not engaged this long after its first frame is called real.
REAL_TIMEOUT_S = 5.0


def _step_reading(frames: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Per frame: the step sweep's largest fall and its candidate frequency; NaN where the sweep is off the grid."""
    n = frames.shape[0]
    best_step = np.full(n, -np.inf, dtype=np.float64)
    best_hz = np.full(n, np.nan, dtype=np.float64)
    any_valid = False
    for hz in STEP_SWEEP_HZ:
        lower = _median_band(frames, grid, hz - STEP_BAND_HZ, hz)
        upper = _median_band(frames, grid, hz, hz + STEP_BAND_HZ)
        if lower is None or upper is None:
            continue
        any_valid = True
        step = lower - upper
        better = step > best_step
        best_step = np.where(better, step, best_step)
        best_hz = np.where(better, hz, best_hz)
    if not any_valid:
        nan = np.full(n, np.nan, dtype=np.float64)
        return nan, nan
    return best_step, best_hz


@dataclass(frozen=True)
class BurstCalc:
    """One burst's every raw frame, in time order: its per-frame step and the running mean's own reading."""

    stamp: str
    track: str
    label: str
    elapsed_s: np.ndarray
    step_val: np.ndarray
    step_hz: np.ndarray
    mean_hz: np.ndarray
    below: np.ndarray
    across: np.ndarray
    above: np.ndarray
    break_val: np.ndarray
    named: dict[float, np.ndarray]


@dataclass(frozen=True)
class Outcome:
    """One burst's outcome at one step cut, warm-up and named/unnamed cut pairing."""

    stamp: str
    track: str
    label: str
    point: Point
    status: str
    seconds: float | None
    named: bool | None


@dataclass
class Corpus:
    """Every burst's outcome over every sweep point, the burst count per track, and each burst's last-frame reading."""

    outcomes: list[Outcome] = field(default_factory=list)
    total_bursts: dict[tuple[str, str], int] = field(default_factory=dict)
    diagnostics: dict[str, tuple[float, float, float, float, float]] = field(default_factory=dict)


def _burst_calc(entry: dict[str, str]) -> BurstCalc:
    """Read one burst's raw frames in time order and score both readings over them, once."""
    stamp, track, label = entry["stamp"], entry["track"], entry["label"]
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    arrived = meta["arrived"]
    t0 = float(arrived[0])

    order: list[tuple[float, int, float, float]] = []
    for group in musical_groups(arrived, musical, HEADLINE_WINDOW):
        block = summed[group]
        step_val_block, step_hz_block = _step_reading(block, grid)
        for local_i, frame_i in enumerate(group):
            order.append(
                (
                    float(arrived[frame_i]) - t0,
                    int(frame_i),
                    float(step_val_block[local_i]),
                    float(step_hz_block[local_i]),
                )
            )
    order.sort(key=lambda o: o[0])
    elapsed_s = np.array([o[0] for o in order], dtype=np.float64)
    frame_idx = np.array([o[1] for o in order], dtype=np.int64)
    step_val = np.array([o[2] for o in order], dtype=np.float64)
    step_hz = np.array([o[3] for o in order], dtype=np.float64)

    raw_kept = summed[frame_idx][:, : grid.kept]
    counts = np.arange(1, raw_kept.shape[0] + 1, dtype=np.float64)[:, None]
    cum_mean = np.cumsum(raw_kept, axis=0) / counts
    smooth_mean = median_smooth(cum_mean, PLATEAU_SMOOTH_BINS)
    _mean_step, mean_hz = _step_reading(smooth_mean, grid)

    n = elapsed_s.shape[0]
    below = np.full(n, np.nan, dtype=np.float64)
    across = np.full(n, np.nan, dtype=np.float64)
    above = np.full(n, np.nan, dtype=np.float64)
    break_val = np.full(n, np.nan, dtype=np.float64)
    for i in range(n):
        hz = mean_hz[i]
        if not np.isfinite(hz):
            continue
        b = _band_slope(smooth_mean[i], grid, hz - SLOPE_GAP_HZ - SLOPE_SPAN_HZ, hz - SLOPE_GAP_HZ)
        a = _band_slope(smooth_mean[i], grid, hz - ACROSS_HALF_HZ, hz + ACROSS_HALF_HZ)
        v = _band_slope(smooth_mean[i], grid, hz + SLOPE_GAP_HZ, hz + SLOPE_GAP_HZ + SLOPE_SPAN_HZ)
        below[i], across[i], above[i] = b, a, v
        if np.isfinite(b) and np.isfinite(a) and np.isfinite(v):
            break_val[i] = min(b - a, v - a)

    named: dict[float, np.ndarray] = {}
    for cut in STEP_CUTS:
        seen: list[float] = []
        flags = np.zeros(n, dtype=bool)
        for i in range(n):
            if seen and np.isfinite(mean_hz[i]):
                flags[i] = any(abs(h - mean_hz[i]) <= CANDIDATE_MATCH_HZ for h in seen)
            if np.isfinite(step_val[i]) and step_val[i] >= cut:
                seen.append(step_hz[i])
        named[cut] = flags

    return BurstCalc(stamp, track, label, elapsed_s, step_val, step_hz, mean_hz, below, across, above, break_val, named)


def _resolve(bc: BurstCalc, point: Point) -> Outcome:
    """One burst's outcome at one sweep point."""
    step_cut, warmup_s, named_cut, unnamed_cut = point
    flags = bc.named[step_cut]
    for i in range(bc.elapsed_s.shape[0]):
        t = bc.elapsed_s[i]
        if t >= warmup_s:
            required = named_cut if flags[i] else unnamed_cut
            if np.isfinite(bc.break_val[i]) and bc.break_val[i] >= required:
                return Outcome(bc.stamp, bc.track, bc.label, point, "engaged", float(t), bool(flags[i]))
        if t >= REAL_TIMEOUT_S:
            return Outcome(bc.stamp, bc.track, bc.label, point, "real", None, None)
    return Outcome(bc.stamp, bc.track, bc.label, point, "unresolved", None, None)


def score_corpus() -> Corpus:
    """Read every graded steady burst once and resolve it at every sweep point."""
    bursts = _steady_bursts()
    corpus = Corpus()
    for n, entry in enumerate(bursts, 1):
        stamp, track, label = entry["stamp"], entry["track"], entry["label"]
        corpus.total_bursts[(track, label)] = corpus.total_bursts.get((track, label), 0) + 1
        bc = _burst_calc(entry)
        if bc.elapsed_s.shape[0]:
            corpus.diagnostics[stamp] = (
                float(bc.mean_hz[-1]),
                float(bc.below[-1]),
                float(bc.across[-1]),
                float(bc.above[-1]),
                float(bc.break_val[-1]),
            )
        else:
            corpus.diagnostics[stamp] = (float("nan"),) * 5
        corpus.outcomes += [_resolve(bc, point) for point in SWEEP]
        if n % 25 == 0 or n == len(bursts):
            print(f"scored {n}/{len(bursts)}", flush=True)
    print(f"outcomes={len(corpus.outcomes)}", flush=True)
    return corpus


def _cell(value: float | None, places: int = 1) -> str:
    """One table cell, or ``none`` where there is no reading."""
    return f"{value:.{places}f}" if value is not None and np.isfinite(value) else "none"


def _tracks(corpus: Corpus) -> list[tuple[str, str]]:
    """Every (track, label) pair, sorted, track order stable across every table."""
    return sorted(corpus.total_bursts)


def _pairing_rows(corpus: Corpus, track: str, label: str, point: Point) -> list[Outcome]:
    """One track's outcomes at one sweep point."""
    return [o for o in corpus.outcomes if o.track == track and o.label == label and o.point == point]


def _fastest(engaged: list[Outcome]) -> Outcome:
    """Return the engaged outcome with the fewest seconds to engage."""
    return min(engaged, key=lambda o: o.seconds if o.seconds is not None else float("inf"))


def per_track_table(corpus: Corpus, point: Point) -> list[str]:
    """One per-track table at one sweep point: engaged, real, unresolved, and the fastest engage's own reading."""
    step_cut, warmup_s, named_cut, unnamed_cut = point
    out = [
        (
            f"### Step cut {step_cut:g} dB, warm-up {warmup_s:g} s, named cut {named_cut:g} dB/kHz, "
            f"unnamed cut {unnamed_cut:g} dB/kHz"
        ),
        "",
        (
            "| track | label | bursts | engaged | real | unresolved | fastest engage s | named | "
            "candidate Hz | below dB/kHz | across dB/kHz | above dB/kHz | break dB/kHz |"
        ),
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for track, label in _tracks(corpus):
        rows = _pairing_rows(corpus, track, label, point)
        engaged = [o for o in rows if o.status == "engaged"]
        real = [o for o in rows if o.status == "real"]
        unresolved = [o for o in rows if o.status == "unresolved"]
        if engaged:
            best = _fastest(engaged)
            diag = corpus.diagnostics.get(best.stamp, (float("nan"),) * 5)
            seconds_cell = _cell(best.seconds)
            named_cell = "yes" if best.named else "no"
            hz_cell, below_cell, across_cell, above_cell, break_cell = (
                _cell(diag[0], 1),
                _cell(diag[1]),
                _cell(diag[2]),
                _cell(diag[3]),
                _cell(diag[4]),
            )
        else:
            seconds_cell = named_cell = hz_cell = below_cell = across_cell = above_cell = break_cell = "none"
        out.append(
            f"| {track} | {label} | {len(rows)} | {len(engaged)} | {len(real)} | {len(unresolved)} | "
            f"{seconds_cell} | {named_cell} | {hz_cell} | {below_cell} | {across_cell} | {above_cell} | {break_cell} |"
        )
    return out


def _summary_row(corpus: Corpus, point: Point) -> str:
    """One summary row at one sweep point: the track counts and the median fake seconds to engage."""
    real_engaged = fake_engaged = fake_engaged_named = fake_only_unresolved = 0
    fake_seconds: list[float] = []
    for track, label in _tracks(corpus):
        rows = _pairing_rows(corpus, track, label, point)
        engaged = [o for o in rows if o.status == "engaged"]
        real = [o for o in rows if o.status == "real"]
        unresolved = [o for o in rows if o.status == "unresolved"]
        if label != "FAKE":
            real_engaged += 1 if engaged else 0
            continue
        if engaged:
            fake_engaged += 1
            best = _fastest(engaged)
            if best.seconds is not None:
                fake_seconds.append(best.seconds)
            fake_engaged_named += 1 if best.named else 0
        if not engaged and not real and unresolved:
            fake_only_unresolved += 1
    median = float(np.median(fake_seconds)) if fake_seconds else None
    step_cut, warmup_s, named_cut, unnamed_cut = point
    return (
        f"| {step_cut:g} | {warmup_s:g} | {named_cut:g} | {unnamed_cut:g} | {real_engaged} | "
        f"{fake_engaged} | {fake_engaged_named} | {fake_only_unresolved} | {_cell(median)} |"
    )


def summary_table(corpus: Corpus) -> list[str]:
    """One row per sweep point: the counts and the median fake seconds to engage."""
    out = [
        "### Summary",
        "",
        (
            "| step cut (dB) | warm-up (s) | named cut (dB/kHz) | unnamed cut (dB/kHz) | real tracks engaged | "
            "fake tracks engaged | fake tracks engaged named | fake tracks only unresolved | "
            "median fake seconds to engage |"
        ),
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    out += [_summary_row(corpus, point) for point in SWEEP]
    return out


def write_report(corpus: Corpus) -> None:
    """Write the summary table and every per-track table to ``REPORT``."""
    lines = [
        "# Two-reading running rule over the labelled corpus",
        "",
        f"Produced by `{RUN_CMD}`.",
        "",
        *summary_table(corpus),
        "",
        "## Per sweep point",
        "",
    ]
    for point in SWEEP:
        lines += [*per_track_table(corpus, point), ""]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT}")


def main() -> None:
    """Score the corpus and write the report."""
    write_report(score_corpus())


if __name__ == "__main__":
    main()
