"""Read candidate FS over the owner-labelled corpus and write the frame-step report.

FS replaces the whole first question and the loud-frame step of the second: a block reads junk where it carries at
least a floor of lit frames and the share of those frames whose own step reaches a step cut clears a share cut. The
policy ``jbpolicyyield.py`` grades under is otherwise kept — the ratio veto forces a block real, and G90 at or above
the working yield line makes the veto stand down.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from jbcandidates import mask_reading
from jbconfig import HEADLINE_WINDOW
from jbcurves import Grid, content_curves, musical_frames
from jbderived import load_burst, musical_groups, summed_db
from jbedge import g90_value
from jbframestep import (
    FRAME_STEP_BAND_HZ,
    FRAME_STEP_CUTS,
    FRAME_STEP_FLOORS,
    FRAME_STEP_FOLDS_HZ,
    FRAME_STEP_GUARD_HZ,
    FRAME_STEP_LIT_DB,
    FRAME_STEP_LIT_HZ,
    FRAME_STEP_SHARE_CUTS,
    lit_steps,
    step_share,
)
from jbimagesrun import IMAGE_NAMED_ALBUM, _steady_bursts
from jbmirror import MIRROR_VETO_LEVEL
from jbpolicy import POLICY_ENGAGE_RUN
from jbpolicyyield import POLICY_RUN_RULE_YIELD_AT

#: Where the report is written, and the command that writes it.
REPORT = Path(__file__).resolve().parents[2] / ".junkburst-report-frame-step.md"
RUN_CMD = "nice -n 10 .venv/bin/python scripts/junkburst/jbframesteprun.py"


@dataclass(frozen=True)
class BlockRow:
    """One steady headline block: its burst, its album and label, FS's readings, and the veto's two inputs."""

    stamp: str
    album: str
    label: str
    frames: int
    lit: int
    shares: dict[float, float]
    g90: float
    ratio: float


@dataclass
class Corpus:
    """Every block the run scores, in burst order, and each album's pooled lit-frame steps."""

    rows: list[BlockRow] = field(default_factory=list)
    steps: dict[str, list[float]] = field(default_factory=dict)


def _burst_rows(stamp: str, album: str, label: str, corpus: Corpus) -> None:
    """Score one burst's headline blocks into the corpus, pooling its lit-frame steps under its album."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    for group in musical_groups(meta["arrived"], musical, HEADLINE_WINDOW):
        block = summed[group]
        steps = lit_steps(block, grid)
        corpus.steps.setdefault(album, []).extend(float(v) for v in steps)
        corpus.rows.append(
            BlockRow(
                stamp=stamp,
                album=album,
                label=label,
                frames=int(block.shape[0]),
                lit=int(steps.size),
                shares={cut: step_share(steps, cut) for cut in FRAME_STEP_CUTS},
                g90=g90_value(block, grid),
                ratio=mask_reading(block, grid).ratio_db,
            )
        )


def score_corpus() -> Corpus:
    """Read every graded steady burst once and score FS and the veto's inputs on its headline blocks."""
    bursts = _steady_bursts()
    corpus = Corpus()
    for n, (stamp, album, label) in enumerate(bursts, 1):
        _burst_rows(stamp, album, label, corpus)
        if n % 25 == 0 or n == len(bursts):
            print(f"scored {n}/{len(bursts)}", flush=True)
    print(f"steady blocks={len(corpus.rows)}", flush=True)
    return corpus


def _cell(value: float, places: int = 3) -> str:
    """One table cell at the places asked for, or ``none`` where there is no reading."""
    return f"{value:.{places}f}" if np.isfinite(value) else "none"


def _median(values: list[float]) -> float:
    """Return the median of the finite values, NaN where there are none."""
    read = [v for v in values if np.isfinite(v)]
    return float(np.median(read)) if read else float("nan")


def _percentiles(values: list[float]) -> list[float]:
    """Return p10, p50 and p90 of the values, NaN throughout where there are none."""
    if not values:
        return [float("nan")] * 3
    return [float(np.percentile(values, p)) for p in (10, 50, 90)]


def album_table(corpus: Corpus) -> list[str]:
    """Per album: its blocks and lit frames, the step's p10, p50 and p90 over them, and the block lit share."""
    per: dict[str, dict[str, Any]] = {}
    for row in corpus.rows:
        entry = per.setdefault(row.album, {"label": row.label, "blocks": 0, "frames": 0, "lit": 0, "shares": []})
        entry["blocks"] += 1
        entry["frames"] += row.frames
        entry["lit"] += row.lit
        entry["shares"].append(row.lit / row.frames if row.frames else float("nan"))
    out = [
        (
            "| album | label | blocks | frames | lit frames | median lit share per block | p10 step | p50 step | "
            "p90 step |"
        ),
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in sorted(per):
        entry = per[name]
        p10, p50, p90 = _percentiles(corpus.steps.get(name, []))
        out.append(
            f"| {name} | {entry['label']} | {entry['blocks']} | {entry['frames']} | {entry['lit']} | "
            f"{_cell(_median(entry['shares']))} | {_cell(p10, 2)} | {_cell(p50, 2)} | {_cell(p90, 2)} |"
        )
    return out


def _junk(row: BlockRow, floor: int, step_cut: float, share_cut: float) -> bool:
    """Report whether a block reads junk: FS clears the floor and the share cut, the ratio veto standing down."""
    if row.lit < floor:
        return False
    share = row.shares[step_cut]
    if not (np.isfinite(share) and share >= share_cut):
        return False
    veto = bool(np.isfinite(row.ratio) and row.ratio >= MIRROR_VETO_LEVEL)
    return (not veto) or bool(np.isfinite(row.g90) and row.g90 >= POLICY_RUN_RULE_YIELD_AT)


def _engages(junk: list[bool]) -> bool:
    """Report whether the burst carries ``POLICY_ENGAGE_RUN`` consecutive junk blocks; a block not junk breaks it."""
    length = 0
    for reading in junk:
        length = length + 1 if reading else 0
        if length >= POLICY_ENGAGE_RUN:
            return True
    return False


def _by_burst(rows: list[BlockRow]) -> dict[str, list[BlockRow]]:
    """Per burst stamp: its blocks, in the order they were scored."""
    out: dict[str, list[BlockRow]] = {}
    for row in rows:
        out.setdefault(row.stamp, []).append(row)
    return out


def _verdict(blocks: list[BlockRow], floor: int, step_cut: float, share_cut: float) -> str:
    """One burst's result: ``thin`` under two scored blocks, else ``engage`` or ``no``."""
    if len(blocks) < POLICY_ENGAGE_RUN:
        return "thin"
    return "engage" if _engages([_junk(b, floor, step_cut, share_cut) for b in blocks]) else "no"


def _tally(row: dict[str, Any], label: str, verdict: str) -> None:
    """Fold one burst's verdict into a grade row, a thin fake burst counted apart rather than against the rule."""
    if label != "FAKE":
        if verdict == "engage":
            row["real_engaged"] += 1
        return
    if verdict == "thin":
        row["fake_thin"] += 1
    elif verdict == "engage":
        row["fake_engaged"] += 1
    else:
        row["fake_missed"] += 1


def _grade_row(bursts: dict[str, list[BlockRow]], floor: int, step_cut: float, share_cut: float) -> dict[str, Any]:
    """One graded row for a single floor, step cut and share cut, folding every burst's verdict."""
    row: dict[str, Any] = {
        "floor": floor,
        "step_cut": step_cut,
        "share_cut": share_cut,
        "real_engaged": 0,
        "fake_engaged": 0,
        "fake_missed": 0,
        "fake_thin": 0,
        "named": {},
    }
    for stamp, blocks in bursts.items():
        verdict = _verdict(blocks, floor, step_cut, share_cut)
        _tally(row, blocks[0].label, verdict)
        if blocks[0].album == IMAGE_NAMED_ALBUM:
            row["named"][stamp] = verdict
    return row


def grade_rows(corpus: Corpus) -> list[dict[str, Any]]:
    """One row per floor, step cut and share cut: the burst counts, and the named album's bursts one by one."""
    bursts = _by_burst(corpus.rows)
    return [
        _grade_row(bursts, floor, step_cut, share_cut)
        for floor in FRAME_STEP_FLOORS
        for step_cut in FRAME_STEP_CUTS
        for share_cut in FRAME_STEP_SHARE_CUTS
    ]


def grade_table(rows: list[dict[str, Any]]) -> list[str]:
    """Return the grade table: one row per floor, step cut and share cut, over every graded steady burst."""
    out = [
        (
            "| lit-frame floor | step cut (dB) | share cut | real bursts engaged | fake bursts engaged | "
            f"fake bursts missed | fake bursts under {POLICY_ENGAGE_RUN} blocks |"
        ),
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    out += [
        f"| {r['floor']} | {r['step_cut']:g} | {r['share_cut']:g} | {r['real_engaged']} | {r['fake_engaged']} | "
        f"{r['fake_missed']} | {r['fake_thin']} |"
        for r in rows
    ]
    return out


def named_tables(rows: list[dict[str, Any]]) -> list[str]:
    """One table per lit-frame floor: every burst of the named album per row, its result at each cut pair."""
    stamps = sorted({stamp for r in rows for stamp in r["named"]})
    pairs = [(step_cut, share_cut) for step_cut in FRAME_STEP_CUTS for share_cut in FRAME_STEP_SHARE_CUTS]
    out: list[str] = []
    for floor in FRAME_STEP_FLOORS:
        at_floor = {(r["step_cut"], r["share_cut"]): r for r in rows if r["floor"] == floor}
        out += [
            f"### {IMAGE_NAMED_ALBUM} at lit-frame floor {floor}",
            "",
            f"Produced by `{RUN_CMD}`.",
            "",
            "| stamp | " + " | ".join(f"{s:g} dB, {sh:g}" for s, sh in pairs) + " |",
            "| --- | " + " | ".join("---" for _ in pairs) + " |",
        ]
        for stamp in stamps:
            cells = " | ".join(at_floor[pair]["named"].get(stamp, "none") for pair in pairs)
            out += [f"| {stamp} | {cells} |"]
        out.append("")
    return out


def _intro() -> str:
    """State what FS reads per frame, which frames it reads, and over which blocks."""
    folds = " and ".join(f"{hz / 1000:g} kHz" for hz in FRAME_STEP_FOLDS_HZ)
    return (
        f"Candidate FS reads, per raw frame, the step across an image fold: the median of that frame's bins over the "
        f"{FRAME_STEP_BAND_HZ / 1000:g} kHz band ending {FRAME_STEP_GUARD_HZ:g} Hz below the fold minus the median "
        f"over the {FRAME_STEP_BAND_HZ / 1000:g} kHz band starting {FRAME_STEP_GUARD_HZ:g} Hz above it, so a fall "
        f"across the fold reads positive. A frame is lit where its mean level over the band "
        f"{FRAME_STEP_LIT_HZ[0]:g} Hz to {FRAME_STEP_LIT_HZ[1] / 1000:g} kHz above that fold, per Hz, reaches "
        f"{FRAME_STEP_LIT_DB:g} dB; an unlit frame carries no step. Both folds are read, {folds}, and a frame lit at "
        f"both takes the step of whichever fold reads the higher level over that band. Every graded steady burst of "
        f"the labelled corpus is scored at {HEADLINE_WINDOW:g} s blocks, and every step distribution below is taken "
        f"over lit frames alone."
    )


def _grade_intro() -> str:
    """State the rule the grade tables are read under, and the policy kept around it."""
    return (
        f"A block reads junk where it carries at least `lit-frame floor` lit frames and the share of those frames "
        f"whose own step reaches `step cut` is at or above `share cut`. The policy around it is "
        f"`jbpolicyyield.py`'s, kept: the {MIRROR_VETO_LEVEL:g} dB ratio veto forces a block real, and G90 at or "
        f"above {POLICY_RUN_RULE_YIELD_AT:g} dB makes that veto stand down. A burst engages on "
        f"{POLICY_ENGAGE_RUN} consecutive junk blocks, a block reading real breaking the run. A burst carrying "
        f"fewer than {POLICY_ENGAGE_RUN} scored blocks cannot engage under any cut, so it is counted apart; it "
        f"reads `thin` in the per-burst tables."
    )


def write_report(corpus: Corpus, rows: list[dict[str, Any]]) -> None:
    """Write every table to ``REPORT``, each under the command that produced it."""
    lines = [
        "# Frame-step candidate FS over the labelled corpus",
        "",
        _intro(),
        "",
        "## Per album",
        "",
        f"Produced by `{RUN_CMD}`.",
        "",
        *album_table(corpus),
        "",
        "## Grade",
        "",
        _grade_intro(),
        "",
        f"Produced by `{RUN_CMD}`.",
        "",
        *grade_table(rows),
        "",
        "## Named album, burst by burst",
        "",
        *named_tables(rows),
    ]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT}")


def main() -> None:
    """Score the corpus and write the report."""
    corpus = score_corpus()
    write_report(corpus, grade_rows(corpus))


if __name__ == "__main__":
    main()
