"""Table the three no-gate, per-raw-frame readings ``jbframeonlyscore.py`` scores, pooled by track, into one report.

Per track and label side: the share of frames at or over each step cut, the median edge frequency and plateau
spread, the shelf and slope-break percentiles, the latch grade at each cut, and the run lengths a track reaches.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbframeonlyscore import (
    EDGE_BAND_HZ,
    EDGE_SWEEP_TOP_HZ,
    PLATEAU_GUARD_HZ,
    PLATEAU_SMOOTH_BINS,
    PLATEAU_TOP_GUARD_HZ,
    PLATEAU_TOP_HZ,
    SLOPE_BAND_HZ,
    SLOPE_DROP_BINS,
    SLOPE_GAP_HZ,
    Corpus,
    FrameRow,
    score_corpus,
)
from jbframestep import FRAME_STEP_FOLDS_HZ

#: Where the report is written, and the command that writes it.
REPORT = Path(__file__).resolve().parents[2] / ".junkburst-report-frame-only.md"
RUN_CMD = "PYTHONPATH=$(pwd) nice -n 10 .venv/bin/python scripts/junkburst/views/jbframeonly.py"

#: The step cuts both the fold step and the edge step are graded at, in dB.
FRAME_ONLY_CUTS = (6.0, 8.0, 10.0, 12.0, 14.0)

#: The run grading's own cuts, a subset of ``FRAME_ONLY_CUTS``, and the fake-track latch lengths in frames.
RUN_CUTS = (10.0, 12.0, 14.0)
RUN_LENGTHS = (3, 5, 10, 20, 47)

#: The shelf reading's own gate, for the edge-step-over-14 dB share.
SHELF_EDGE_CUT = 14.0
SHELF_SHARE_CUT = -6.0

#: The edge-step gate the slope break's gated percentiles are read over.
BREAK_EDGE_CUT = 14.0

#: The break conditions layered onto the edge-step runs, in dB per kHz.
BREAK_RUN_CUTS = (3.0, 5.0)

#: The two graded statistics, each with the reader that takes it off a frame.
STATS: tuple[tuple[str, Any], ...] = (("Fold step", lambda f: f.fold_step), ("Edge step", lambda f: f.edge_step))


def _share(values: np.ndarray, cut: float) -> float:
    """Return the share of finite values reaching a cut, NaN where none is finite."""
    finite = values[np.isfinite(values)]
    return float(np.mean(finite >= cut)) if finite.size else float("nan")


def _median_finite(values: np.ndarray) -> float:
    """Return the median of the finite values, NaN where there are none."""
    finite = values[np.isfinite(values)]
    return float(np.median(finite)) if finite.size else float("nan")


def _percentile_finite(values: np.ndarray, pct: float) -> float:
    """Return the given percentile of the finite values, NaN where there are none."""
    finite = values[np.isfinite(values)]
    return float(np.percentile(finite, pct)) if finite.size else float("nan")


def _cell(value: float, places: int = 3) -> str:
    """One table cell at the places asked for, or ``none`` where there is no reading."""
    return f"{value:.{places}f}" if np.isfinite(value) else "none"


def _by_track(rows: list[FrameRow]) -> dict[tuple[str, str], list[FrameRow]]:
    """Every frame keyed by (track, label side), tracks in a stable sorted order."""
    out: dict[tuple[str, str], list[FrameRow]] = {}
    for row in rows:
        out.setdefault((row.track, row.label), []).append(row)
    return out


def _statistic_table(per: dict[tuple[str, str], list[FrameRow]], title: str, reader: Any) -> list[str]:
    """One share table for a single statistic: track, label, frame count, and its share at each cut."""
    out = [
        f"### {title}",
        "",
        "| track | label | frames | " + " | ".join(f"share ≥ {c:g} dB" for c in FRAME_ONLY_CUTS) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in FRAME_ONLY_CUTS) + " |",
    ]
    for track, label in sorted(per):
        frames = per[(track, label)]
        values = np.array([reader(f) for f in frames], dtype=np.float64)
        shares = " | ".join(_cell(_share(values, c)) for c in FRAME_ONLY_CUTS)
        out.append(f"| {track} | {label} | {len(frames)} | {shares} |")
    return out


def edge_medians_table(per: dict[tuple[str, str], list[FrameRow]]) -> list[str]:
    """Per track and label: the median edge frequency and the median plateau spread."""
    out = [
        "### Median edge frequency and plateau spread, per track",
        "",
        "| track | label | frames | median edge frequency (Hz) | median plateau spread (dB) |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for track, label in sorted(per):
        frames = per[(track, label)]
        hz = np.array([f.edge_hz for f in frames], dtype=np.float64)
        plateau = np.array([f.plateau for f in frames], dtype=np.float64)
        out.append(
            f"| {track} | {label} | {len(frames)} | {_cell(_median_finite(hz), 1)} | "
            f"{_cell(_median_finite(plateau))} |"
        )
    return out


def shelf_table(per: dict[tuple[str, str], list[FrameRow]]) -> list[str]:
    """Per track and label: the shelf reading's p10/p50/p90, and the over-14 dB edge-step share at or above -6 dB."""
    out = [
        "### Shelf reading, per track",
        "",
        (
            "| track | label | frames | p10 (dB) | p50 (dB) | p90 (dB) | "
            f"share of edge-step ≥ {SHELF_EDGE_CUT:g} dB frames with shelf ≥ {SHELF_SHARE_CUT:g} dB |"
        ),
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for track, label in sorted(per):
        frames = per[(track, label)]
        shelf = np.array([f.shelf for f in frames], dtype=np.float64)
        p10, p50, p90 = (_cell(_percentile_finite(shelf, p)) for p in (10, 50, 90))
        gated = [f.shelf for f in frames if np.isfinite(f.edge_step) and f.edge_step >= SHELF_EDGE_CUT]
        gated_arr = np.array(gated, dtype=np.float64)
        share = _cell(_share(gated_arr, SHELF_SHARE_CUT)) if gated_arr.size else "none"
        out.append(f"| {track} | {label} | {len(frames)} | {p10} | {p50} | {p90} | {share} |")
    return out


def break_table(per: dict[tuple[str, str], list[FrameRow]]) -> list[str]:
    """Per track and label: the slope break's p10/p50/p90, over every frame and over the edge-step-gated frames."""
    out = [
        "### Slope break, per track",
        "",
        (
            "| track | label | frames | p10 (dB/kHz) | p50 (dB/kHz) | p90 (dB/kHz) | "
            f"p10 edge-step ≥ {BREAK_EDGE_CUT:g} dB | p50 edge-step ≥ {BREAK_EDGE_CUT:g} dB | "
            f"p90 edge-step ≥ {BREAK_EDGE_CUT:g} dB |"
        ),
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for track, label in sorted(per):
        frames = per[(track, label)]
        brk = np.array([f.edge_break for f in frames], dtype=np.float64)
        gated = np.array(
            [f.edge_break for f in frames if np.isfinite(f.edge_step) and f.edge_step >= BREAK_EDGE_CUT],
            dtype=np.float64,
        )
        p10, p50, p90 = (_cell(_percentile_finite(brk, p)) for p in (10, 50, 90))
        gp10, gp50, gp90 = (_cell(_percentile_finite(gated, p)) for p in (10, 50, 90))
        out.append(f"| {track} | {label} | {len(frames)} | {p10} | {p50} | {p90} | {gp10} | {gp50} | {gp90} |")
    return out


def _segments(frames: list[FrameRow]) -> list[list[FrameRow]]:
    """Group frames into contiguous same-burst segments, in the order they were scored."""
    segments: list[list[FrameRow]] = []
    current: list[FrameRow] = []
    for f in frames:
        if current and current[-1].stamp != f.stamp:
            segments.append(current)
            current = []
        current.append(f)
    if current:
        segments.append(current)
    return segments


def _runs(segment: list[FrameRow], pred: Any) -> list[list[FrameRow]]:
    """Maximal runs of consecutive frames meeting ``pred`` within one burst's segment, in order."""
    runs: list[list[FrameRow]] = []
    current: list[FrameRow] = []
    for f in segment:
        if pred(f):
            current.append(f)
        else:
            if current:
                runs.append(current)
            current = []
    if current:
        runs.append(current)
    return runs


def _longest_run(frames: list[FrameRow], pred: Any) -> tuple[int, str | None]:
    """Return the longest run meeting ``pred`` over every burst of one track, and the stamp of the burst holding it."""
    best_len, best_stamp = 0, None
    for segment in _segments(frames):
        for run in _runs(segment, pred):
            if len(run) > best_len:
                best_len, best_stamp = len(run), run[0].stamp
    return best_len, best_stamp


def _fake_first_run_seconds(frames: list[FrameRow], pred: Any, length: int) -> float | None:
    """Seconds from the track's own first frame to the end of its first run meeting ``pred`` of ``length`` frames."""
    t0 = min(f.in_track_s for f in frames)
    segments = sorted(_segments(frames), key=lambda segment: segment[0].in_track_s)
    for segment in segments:
        for run in _runs(segment, pred):
            if len(run) >= length:
                return run[-1].in_track_s - t0
    return None


def _cut_pred(reader: Any, cut: float) -> Any:
    """Return a predicate a frame meets when ``reader`` reads at or over ``cut``."""
    return lambda f: np.isfinite(reader(f)) and reader(f) >= cut


def _cut_break_pred(reader: Any, cut: float, break_cut: float) -> Any:
    """Return a predicate a frame meets when ``reader`` reaches ``cut`` and its slope break reaches ``break_cut``."""
    step, brk = _cut_pred(reader, cut), _cut_pred(lambda f: f.edge_break, break_cut)
    return lambda f: step(f) and brk(f)


def run_length_table(per: dict[tuple[str, str], list[FrameRow]], title: str, pred: Any) -> list[str]:
    """One per-track run-length table for one condition."""
    out = [
        f"### {title}",
        "",
        "| track | label | real: longest run (frames) | real: burst holding max | "
        + " | ".join(f"fake: run ≥ {n} (s)" for n in RUN_LENGTHS)
        + " |",
        "| --- | --- | ---: | --- | " + " | ".join("---:" for _ in RUN_LENGTHS) + " |",
    ]
    for track, label in sorted(per):
        frames = per[(track, label)]
        if label == "FAKE":
            cells = " | ".join(
                (f"{s:.1f}" if s is not None else "none")
                for s in (_fake_first_run_seconds(frames, pred, n) for n in RUN_LENGTHS)
            )
            out.append(f"| {track} | {label} | | | {cells} |")
        else:
            length, stamp = _longest_run(frames, pred)
            blanks = " | ".join("" for _ in RUN_LENGTHS)
            out.append(f"| {track} | {label} | {length} | {stamp or 'none'} | {blanks} |")
    return out


def run_summary_table(per: dict[tuple[str, str], list[FrameRow]], title: str, pred: Any) -> list[str]:
    """One length-by-length count of real tracks reaching it and fake tracks reaching it at all, for one condition."""
    out = [
        f"### {title}",
        "",
        "| run length (frames) | real tracks reaching it | fake tracks reaching it |",
        "| ---: | ---: | ---: |",
    ]
    real = {tl: per[tl] for tl in per if tl[1] != "FAKE"}
    fake = {tl: per[tl] for tl in per if tl[1] == "FAKE"}
    real_longest = {tl: _longest_run(frames, pred)[0] for tl, frames in real.items()}
    fake_seconds = {tl: [_fake_first_run_seconds(frames, pred, n) for n in RUN_LENGTHS] for tl, frames in fake.items()}
    for i, length in enumerate(RUN_LENGTHS):
        real_count = sum(1 for v in real_longest.values() if v >= length)
        fake_count = sum(1 for seconds in fake_seconds.values() if seconds[i] is not None)
        out.append(f"| {length} | {real_count} | {fake_count} |")
    return out


def _latch_row(track: str, label: str, frames: list[FrameRow], reader: Any, cut: float) -> str:
    """One latch-grade row: a fake track's seconds to first over-cut frame, a real track's count and top stamp."""
    ordered = sorted(frames, key=lambda f: f.in_track_s)
    if label == "FAKE":
        t0 = ordered[0].in_track_s
        hit = next((f for f in ordered if np.isfinite(reader(f)) and reader(f) >= cut), None)
        seconds = _cell(hit.in_track_s - t0, 1) if hit is not None else "none"
        return f"| {track} | {label} | {seconds} | | |"
    count = sum(1 for f in frames if np.isfinite(reader(f)) and reader(f) >= cut)
    top = max(frames, key=lambda f: reader(f) if np.isfinite(reader(f)) else -np.inf)
    top_stamp = top.stamp if np.isfinite(reader(top)) else "none"
    return f"| {track} | {label} | | {count} | {top_stamp} |"


def latch_table(per: dict[tuple[str, str], list[FrameRow]], title: str, reader: Any, cut: float) -> list[str]:
    """One per-track latch grade at one cut of one statistic."""
    out = [
        f"### {title} at {cut:g} dB",
        "",
        "| track | label | fake: seconds to first ≥ cut | real: frames ≥ cut | real: burst holding the max |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    out += [_latch_row(track, label, per[(track, label)], reader, cut) for track, label in sorted(per)]
    return out


def _intro() -> str:
    """State what each of the three no-gate readings is, and that every raw frame is read."""
    return (
        f"Every raw frame of every steady headline block ({HEADLINE_WINDOW:g} s) of the labelled corpus is read "
        f"here, with no lit gate and no per-block quantity of any kind. The fold step is "
        f"`jbframestep.fold_frame_step` at {', '.join(f'{hz / 1000:g} kHz' for hz in FRAME_STEP_FOLDS_HZ)}, the "
        f"larger of the two folds taken. The edge step is the largest fall between the median of a "
        f"{EDGE_BAND_HZ / 1000:g} kHz band and the median of the {EDGE_BAND_HZ / 1000:g} kHz band directly above "
        f"it, the lower band's own top swept {EDGE_SWEEP_TOP_HZ[0] / 1000:g} to {EDGE_SWEEP_TOP_HZ[-1] / 1000:g} "
        f"kHz in 250 Hz steps; its frequency is where that sweep found it. The plateau spread is the p90 minus p10 "
        f"of the {PLATEAU_SMOOTH_BINS}-bin-smoothed frame from {PLATEAU_GUARD_HZ / 1000:g} kHz above that frame's "
        f"own edge to {PLATEAU_TOP_HZ / 1000:g} kHz or the container top less {PLATEAU_TOP_GUARD_HZ / 1000:g} kHz, "
        f"whichever is lower. The shelf reading is the median of the {EDGE_BAND_HZ / 1000:g} kHz band directly "
        f"under the winning edge's lower band minus that lower band's own median. A track pools every burst joined "
        f"to it through `tracks.tsv` and `labels.tsv`, its frames ordered by that burst's own `position_s` plus "
        f"the frame's elapsed time since its burst's first frame. A run of consecutive frames at or over a cut "
        f"never crosses a burst boundary. The slope break is the least-squares slope in dB per kHz of the "
        f"{PLATEAU_SMOOTH_BINS}-bin-smoothed frame over the {SLOPE_BAND_HZ / 1000:g} kHz above the edge minus the "
        f"same fit over the {SLOPE_BAND_HZ / 1000:g} kHz below it, each fit's own {SLOPE_GAP_HZ:g} Hz gap off the "
        f"edge and each dropping its {SLOPE_DROP_BINS} highest-dB bins before the fit."
    )


def _run_conditions() -> list[tuple[str, str, Any]]:
    """Every run condition graded: its run-length title, its summary title, and the predicate a frame must meet."""
    out: list[tuple[str, str, Any]] = []
    for title, reader in STATS:
        for cut in RUN_CUTS:
            tail = f" at {cut:g} dB"
            out.append((f"{title} run length{tail}", f"{title} run-length summary{tail}", _cut_pred(reader, cut)))
    edge_reader = dict(STATS)["Edge step"]
    for break_cut in BREAK_RUN_CUTS:
        for cut in RUN_CUTS:
            tail = f" at {cut:g} dB, break ≥ {break_cut:g} dB/kHz"
            pred = _cut_break_pred(edge_reader, cut, break_cut)
            out.append((f"Edge step run length{tail}", f"Edge step run-length summary{tail}", pred))
    return out


def write_report(corpus: Corpus) -> None:
    """Write every table to ``REPORT``, each under the command that produced it."""
    per = _by_track(corpus.rows)
    lines = [
        "# Frame-only no-gate readings over the labelled corpus",
        "",
        _intro(),
        "",
        f"Produced by `{RUN_CMD}`.",
        "",
        "## Fold step and edge step, per track",
        "",
        *_statistic_table(per, "Fold step", lambda f: f.fold_step),
        "",
        *_statistic_table(per, "Edge step", lambda f: f.edge_step),
        "",
        *edge_medians_table(per),
        "",
        *shelf_table(per),
        "",
        *break_table(per),
        "",
        "## Latch grade",
        "",
    ]
    for title, reader in STATS:
        for cut in FRAME_ONLY_CUTS:
            lines += [*latch_table(per, title, reader, cut), ""]
    conditions = _run_conditions()
    lines += ["## Run length", ""]
    for title, _summary_title, pred in conditions:
        lines += [*run_length_table(per, title, pred), ""]
    lines += ["## Run-length summary", ""]
    for _title, summary_title, pred in conditions:
        lines += [*run_summary_table(per, summary_title, pred), ""]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT}")


def main() -> None:
    """Score the corpus and write the report."""
    write_report(score_corpus())


if __name__ == "__main__":
    main()
