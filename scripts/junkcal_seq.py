#!/usr/bin/env python3
"""Replay whole junkcal captures through the shipped detector in tick order and score the sequence.

``scripts/junkcal_eval.py`` scores one row at a time against that row's own statistics, which is the
right question for the detector's arithmetic and the wrong one for auto-pilot: auto-pilot writes to
hqplayerd whenever the verdict changes, so what it costs the listener is a property of the sequence
of verdicts over a capture, not of any row in it. This script asks the sequence question.

One album file (or one fixture album) is replayed row by row into ``junkadvisor.classify`` with a
``SpurHolder`` carried across rows exactly as ``MeteringReader`` carries it, and the verdict is put
through ``autopilot.desired_junk_filter`` with that row's engaged main filter, which is the name
auto-pilot would write. The reader discards the aggregate and the hold only when the stream breaks,
which a capture shows as ``seconds`` going backwards, so the replay resets the holder there and
nowhere else — not at a track change, which the reader does not treat as a break either.

The corpus is ``manifest.json``, written by ``scripts/junkcal_split.py``: one file per album, one
file per gap between albums, each with the label the fixture gave it. A sequence is one such file,
so every tick is graded against the album it belongs to and no tick is graded across an album
boundary. A gap file carries no label, so it is replayed and its writes counted, and none of its
ticks is graded.

Reported per sequence: the album label, the run-length-compressed verdict sequence, the number of
writes auto-pilot would make, the number of ticks disagreeing with the label, and the time to the
first correct verdict.

The corpus and the fixture are read, never written.
"""

from __future__ import annotations

import argparse
import gzip
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from hqptuner.engine import junkadvisor
from hqptuner.lanes import autopilot

Row = dict[str, Any]

CAPTURES = Path("/srv/hqptuner/state/junkcal")

#: The corpus index inside the capture directory: one entry per album file and per gap file.
MANIFEST = "manifest.json"

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "support" / "fixtures" / "junkcal"

#: Runs printed per sequence before the tail is elided; the counts beside it carry the rest.
SHOWN_RUNS = 10


@dataclass(frozen=True)
class Tick:
    """One poll: the filter auto-pilot would want, the album label in force, and the aggregate's age."""

    want: str
    label: str | None
    seconds: float


@dataclass(frozen=True)
class Score:
    """One replayed sequence, scored."""

    name: str
    labels: str
    ticks: int
    labelled: int
    writes: int
    first_write_wrong: bool
    wrong: int
    first_correct_s: float | None
    runs: list[tuple[str, int]]


def full_curve(row: Row) -> list[float]:
    """Return one row's spectrum on the full bin grid the detector indexes.

    A capture stores ``[hz, db]`` pairs from 13 kHz up (``hqptuner/core/junkcal.py``
    ``SPECTRUM_FLOOR_HZ``), so the head of the grid is restored at the row's own maximum level: no
    rule reads a band that low, and the only statistic the fill can reach is the 10th-percentile
    floor, which must go on reading the HF tail rather than the fill.
    """
    spec = row["spectrum"]
    if spec and isinstance(spec[0], list):
        levels = [float(pair[1]) for pair in spec]
        return [max(levels)] * (int(row["bins"]) - len(levels)) + levels
    return [float(v) for v in spec]


def sequences(captures: Path) -> list[tuple[str, Path, str | None]]:
    """Return one name, path and label per file the manifest lists, gap files carrying no label."""
    with (captures / MANIFEST).open(encoding="utf-8") as fh:
        manifest: dict[str, dict[str, Any]] = json.load(fh)
    out: list[tuple[str, Path, str | None]] = []
    for name, entry in sorted(manifest.items()):
        label = entry["label"]
        out.append((name.removesuffix(".jsonl"), captures / name, None if label is None else str(label)))
    return out


def album_rows(fixtures: Path, stamp: str) -> list[Row]:
    """Return one fixture album's rows in capture order."""
    with gzip.open(fixtures / f"{stamp}.jsonl.gz", "rt", encoding="utf-8") as gz:
        return [json.loads(line) for line in gz if line.strip()]


def capture_rows(path: Path) -> list[Row]:
    """Return one capture file's rows in capture order."""
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def replay(rows: list[Row], fixed: str | None) -> list[Tick]:
    """Replay rows in order through the shipped detector, carrying one holder as the reader does.

    ``fixed`` is the album label every tick of this file is graded against, or None for a gap file,
    whose ticks are replayed and counted but graded against nothing.
    """
    holder = junkadvisor.SpurHolder()
    previous: float | None = None
    ticks: list[Tick] = []
    for row in rows:
        seconds = float(row["seconds"])
        if previous is not None and seconds < previous:
            holder = junkadvisor.SpurHolder()  # a broken stream: the reader drops the hold with the aggregate
        previous = seconds
        verdict = row_verdict(row, holder)
        ticks.append(Tick(autopilot.desired_junk_filter(verdict, row.get("filter")), fixed, seconds))
    return ticks


def row_verdict(row: Row, holder: junkadvisor.SpurHolder) -> dict[str, Any] | None:
    """Return the signature one row's stored windowed minimum carries, or None where it carries none."""
    if row.get("spectrum") is None:
        return None
    return junkadvisor.classify(
        full_curve(row),
        float(row["bandwidth"]),
        samplerate=int(row["samplerate"]),
        sdm=bool(row.get("sdm", False)),
        holder=holder,
    )


def compress(ticks: list[Tick]) -> list[tuple[str, int]]:
    """Return the verdict sequence run-length compressed: one pair per run of an unchanged verdict."""
    runs: list[tuple[str, int]] = []
    for tick in ticks:
        if runs and runs[-1][0] == tick.want:
            runs[-1] = (tick.want, runs[-1][1] + 1)
        else:
            runs.append((tick.want, 1))
    return runs


def writes(rows: list[Row], ticks: list[Tick]) -> list[Tick]:
    """Return the ticks at which auto-pilot would write, starting from the filter engaged at row one."""
    engaged = str(rows[0].get("junk_filter") or junkadvisor.NO_FILTER) if rows else junkadvisor.NO_FILTER
    made: list[Tick] = []
    for tick in ticks:
        if tick.want != engaged:
            made.append(tick)
            engaged = tick.want
    return made


def score(name: str, rows: list[Row], ticks: list[Tick]) -> Score:
    """Score one replayed sequence."""
    labelled = [tick for tick in ticks if tick.label is not None]
    correct = [tick for tick in labelled if tick.want == tick.label]
    made = writes(rows, ticks)
    first = made[0] if made else None
    names = sorted({tick.label for tick in labelled if tick.label is not None})
    return Score(
        name=name,
        labels="+".join(names) if names else "-",
        ticks=len(ticks),
        labelled=len(labelled),
        writes=len(made),
        first_write_wrong=first is not None and first.label is not None and first.want != first.label,
        wrong=len(labelled) - len(correct),
        first_correct_s=correct[0].seconds if correct else None,
        runs=compress(ticks),
    )


def show_runs(runs: list[tuple[str, int]]) -> str:
    """Return the compressed sequence as text, the tail elided past SHOWN_RUNS."""
    shown = " ".join(f"{name}x{count}" for name, count in runs[:SHOWN_RUNS])
    return shown if len(runs) <= SHOWN_RUNS else f"{shown} ... (+{len(runs) - SHOWN_RUNS} runs)"


def print_scores(title: str, scores: list[Score]) -> None:
    """Print one line per sequence plus the corpus counts the sequence question is asked for."""
    print(f"== {title}: {len(scores)} sequences ==")
    for item in sorted(scores, key=lambda s: (-s.wrong, -s.writes, s.name)):
        first = "-" if item.first_correct_s is None else f"{item.first_correct_s:.0f}s"
        print(
            f"{item.name} label={item.labels} ticks={item.ticks} labelled={item.labelled} "
            f"writes={item.writes} first_write_wrong={int(item.first_write_wrong)} "
            f"wrong={item.wrong} first_correct={first} "
            f"seq: {show_runs(item.runs)}"
        )
    graded = [item for item in scores if item.labelled]
    print(
        f"-- totals: writes={sum(item.writes for item in scores)} "
        f"sequences_over_one_write={sum(1 for item in scores if item.writes > 1)} "
        f"first_write_wrong={sum(1 for item in graded if item.first_write_wrong)} "
        f"graded={len(graded)} "
        f"ticks={sum(item.ticks for item in scores)} "
        f"wrong_ticks={sum(item.wrong for item in graded)} "
        f"labelled_ticks={sum(item.labelled for item in scores)}"
    )


def capture_scores(captures: Path) -> list[Score]:
    """Score every file the manifest lists, each against its own album label."""
    scores: list[Score] = []
    for name, path, label in sequences(captures):
        rows = capture_rows(path)
        if rows:
            scores.append(score(name, rows, replay(rows, label)))
    return scores


def album_scores(fixtures: Path) -> list[Score]:
    """Score every album in the fixture corpus."""
    with (fixtures / "labels.json").open(encoding="utf-8") as fh:
        labels: dict[str, Any] = json.load(fh)
    scores: list[Score] = []
    for stamp, label in sorted(labels.items()):
        rows = album_rows(fixtures, stamp)
        if rows:
            scores.append(score(stamp, rows, replay(rows, str(label["junk_filter"]))))
    return scores


def check(captures: Path) -> None:
    """Print how often the replay reproduces the ``desired_junk_filter`` each capture row recorded live.

    The replay's fidelity is the whole measure: a row's stored column is what auto-pilot actually
    wanted at that poll. Only a capture taken under the shipped rules can agree — an older one
    records the rules of its own night — so the count is printed per file rather than pooled.
    """
    for name, path, _ in sequences(captures):
        rows = capture_rows(path)
        if not rows:
            continue
        ticks = replay(rows, None)
        same = sum(1 for row, tick in zip(rows, ticks, strict=True) if str(row["desired_junk_filter"]) == tick.want)
        print(f"{name} replay_matches_stored={same}/{len(rows)}")


def main() -> None:
    """Replay the capture corpus and the fixture corpus and print both matrices."""
    ap = argparse.ArgumentParser(description="replay junkcal captures through the detector in tick order")
    ap.add_argument("--captures", type=Path, default=CAPTURES, help="directory holding manifest.json and its files")
    ap.add_argument("--fixtures", type=Path, default=FIXTURES, help="fixture directory to replay")
    ap.add_argument("--check", action="store_true", help="compare the replay against each row's stored verdict")
    args = ap.parse_args()

    if args.check:
        check(args.captures)
        return
    print_scores("manifest files", capture_scores(args.captures))
    print()
    print_scores("fixture albums (kept rows only, not a tick sequence)", album_scores(args.fixtures))


if __name__ == "__main__":
    main()
