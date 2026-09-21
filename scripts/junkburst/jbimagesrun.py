"""Read candidate I over the owner-labelled corpus and write the image-fold report.

The share replaces the mask level line as the first question a block is asked: a block is kept where its share of
mirrored frames clears the share cut, rather than where its above-fold level clears ``MASK_SWEEP_ALBUM_LEVEL``.
The second question is unchanged, the one ``jbpolicyyield.py`` grades under — G90 against its fixed cut, the ratio
veto forcing a block real, and the loud-frame step yielding that veto at the working line.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from jbcandidates import mask_reading
from jbconfig import BY_TRACK, DER, HEADLINE_WINDOW
from jbcurves import Grid, content_curves, musical_frames
from jbderived import load_burst, musical_groups, summed_db
from jbedge import g90_value
from jbimages import CANDIDATE_I_CUTS, CANDIDATE_I_FOLDS_HZ, CANDIDATE_I_SPAN_HZ, block_share, frame_corr
from jblabels import collapse_overlaps, load_labels, load_tracks, owner_label, primary_artist
from jbmirror import MIRROR_VETO_LEVEL
from jbpolicy import POLICY_ENGAGE_RUN, POLICY_G90_FIXED_CUT
from jbpolicyyield import POLICY_RUN_RULE_YIELD_AT

#: The share cuts the first question is swept over.
IMAGE_SHARE_CUTS = tuple(round(0.1 * i, 1) for i in range(1, 10))
#: The album whose every burst the grade tables report outright.
IMAGE_NAMED_ALBUM = "Foundations of Burden"
#: Where the report is written, and the command that writes it.
REPORT = Path(__file__).resolve().parents[2] / ".junkburst-report-images.md"
RUN_CMD = "nice -n 10 .venv/bin/python scripts/junkburst/jbimagesrun.py"


@dataclass(frozen=True)
class BlockRow:
    """One steady headline block: its burst, its album and label, candidate I's readings, and the second question's."""

    stamp: str
    album: str
    label: str
    shares: dict[float, float]
    g90: float
    ratio: float


@dataclass
class Corpus:
    """Every block the run scores, in burst order, and each album's pooled per-frame correlations."""

    rows: list[BlockRow] = field(default_factory=list)
    frames: dict[str, list[float]] = field(default_factory=dict)


def _burst_rows(stamp: str, album: str, label: str, corpus: Corpus) -> None:
    """Score one burst's headline blocks into the corpus, pooling its frame correlations under its album."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    summed = summed_db(db)
    del db
    curves = content_curves(summed, grid)
    musical = musical_frames(summed, grid, curves)
    for group in musical_groups(meta["arrived"], musical, HEADLINE_WINDOW):
        block = summed[group]
        corr = frame_corr(block, grid)
        corpus.frames.setdefault(album, []).extend(float(v) for v in corr[np.isfinite(corr)])
        corpus.rows.append(
            BlockRow(
                stamp=stamp,
                album=album,
                label=label,
                shares={cut: block_share(corr, cut) for cut in CANDIDATE_I_CUTS},
                g90=g90_value(block, grid),
                ratio=mask_reading(block, grid).ratio_db,
            )
        )


def _steady_bursts() -> list[tuple[str, str, str]]:
    """Every graded steady burst as (stamp, album row key, owner label), duplicate arrivals collapsed."""
    tracks = load_tracks()
    by_album, by_track = load_labels()
    stamps = sorted(p.stem for p in DER.glob("*.npy"))
    labelled = [s for s in stamps if owner_label(s, tracks, by_album, by_track) is not None]
    graded, duplicates = collapse_overlaps(labelled)
    print(f"derived={len(stamps)} labelled={len(labelled)} duplicates={len(duplicates)} graded={len(graded)}")
    out = []
    for stamp in graded:
        row = tracks.get(stamp, {})
        if row.get("transition", "").strip() == "yes":
            continue
        artist, album, track = row.get("artist", "").strip(), row.get("album", "").strip(), row.get("track", "").strip()
        key = album or f"{artist} (no album)"
        if by_album.get((primary_artist(artist), album)) == BY_TRACK:
            key = f"{key} — {track}"
        label = owner_label(stamp, tracks, by_album, by_track)
        assert label is not None
        out.append((stamp, key, label))
    return out


def score_corpus() -> Corpus:
    """Read every graded steady burst once and score candidate I and the second question on its headline blocks."""
    bursts = _steady_bursts()
    corpus = Corpus()
    for n, (stamp, album, label) in enumerate(bursts, 1):
        _burst_rows(stamp, album, label, corpus)
        if n % 25 == 0 or n == len(bursts):
            print(f"scored {n}/{len(bursts)}", flush=True)
    print(f"steady blocks={len(corpus.rows)}", flush=True)
    return corpus


def _median(values: list[float]) -> float:
    """Return the median of the finite values, NaN when there are none."""
    read = [v for v in values if np.isfinite(v)]
    return float(np.median(read)) if read else float("nan")


def album_table(corpus: Corpus) -> list[str]:
    """Per album: its label, its blocks and frames, its median frame correlation, and its median block share."""
    per: dict[str, dict[str, Any]] = {}
    for row in corpus.rows:
        blank: dict[float, list[float]] = {c: [] for c in CANDIDATE_I_CUTS}
        entry = per.setdefault(row.album, {"label": row.label, "blocks": 0, "shares": blank})
        entry["blocks"] += 1
        for cut in CANDIDATE_I_CUTS:
            entry["shares"][cut].append(row.shares[cut])
    head = "| album | label | blocks | frames | median frame correlation | " + " | ".join(
        f"median block share at {cut:g}" for cut in CANDIDATE_I_CUTS
    )
    out = [head + " |", "| --- | --- | ---: | ---: | ---: | " + " | ".join("---:" for _ in CANDIDATE_I_CUTS) + " |"]
    for name in sorted(per):
        entry = per[name]
        frames = corpus.frames.get(name, [])
        shares = " | ".join(_cell(_median(entry["shares"][cut])) for cut in CANDIDATE_I_CUTS)
        out.append(
            f"| {name} | {entry['label']} | {entry['blocks']} | {len(frames)} | {_cell(_median(frames))} | {shares} |"
        )
    return out


def _cell(value: float) -> str:
    """One table cell to three decimals, or ``none`` where there is no reading."""
    return f"{value:.3f}" if np.isfinite(value) else "none"


def _kept(row: BlockRow, corr_cut: float, share_cut: float) -> bool:
    """Report whether the block's share of mirrored frames clears the share cut; a NaN share never does."""
    share = row.shares[corr_cut]
    return bool(np.isfinite(share) and share >= share_cut)


def _junk(row: BlockRow, corr_cut: float, share_cut: float) -> bool:
    """Report whether a kept block reads junk: G90 clears its cut, the ratio veto standing down or yielding to it."""
    if not _kept(row, corr_cut, share_cut):
        return False
    if not (np.isfinite(row.g90) and row.g90 >= POLICY_G90_FIXED_CUT):
        return False
    veto = bool(np.isfinite(row.ratio) and row.ratio >= MIRROR_VETO_LEVEL)
    return (not veto) or row.g90 >= POLICY_RUN_RULE_YIELD_AT


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


def _verdict(blocks: list[BlockRow], corr_cut: float, share_cut: float) -> str:
    """One burst's result: ``thin`` under two kept blocks, else ``engage`` or ``no``."""
    if sum(1 for b in blocks if _kept(b, corr_cut, share_cut)) < POLICY_ENGAGE_RUN:
        return "thin"
    return "engage" if _engages([_junk(b, corr_cut, share_cut) for b in blocks]) else "no"


def grade_rows(corpus: Corpus) -> list[dict[str, Any]]:
    """One row per correlation cut and share cut: the burst counts, and the named album's bursts one by one."""
    bursts = _by_burst(corpus.rows)
    out = []
    for corr_cut in CANDIDATE_I_CUTS:
        for share_cut in IMAGE_SHARE_CUTS:
            row: dict[str, Any] = {
                "corr_cut": corr_cut,
                "share_cut": share_cut,
                "real_engaged": 0,
                "fake_engaged": 0,
                "fake_missed": 0,
                "fake_thin": 0,
                "named": {},
            }
            for stamp, blocks in bursts.items():
                verdict = _verdict(blocks, corr_cut, share_cut)
                _tally(row, blocks[0].label, verdict)
                if blocks[0].album == IMAGE_NAMED_ALBUM:
                    row["named"][stamp] = verdict
            out.append(row)
    return out


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


def grade_table(rows: list[dict[str, Any]]) -> list[str]:
    """Return the grade table: one row per correlation cut and share cut, over every graded steady burst."""
    out = [
        (
            "| correlation cut | share cut | real bursts engaged | fake bursts engaged | fake bursts missed | "
            f"fake bursts under {POLICY_ENGAGE_RUN} kept blocks |"
        ),
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    out += [
        f"| {r['corr_cut']:g} | {r['share_cut']:g} | {r['real_engaged']} | {r['fake_engaged']} | "
        f"{r['fake_missed']} | {r['fake_thin']} |"
        for r in rows
    ]
    return out


def named_tables(rows: list[dict[str, Any]]) -> list[str]:
    """One table per correlation cut: every burst of the named album, its result at each share cut."""
    stamps = sorted({stamp for r in rows for stamp in r["named"]})
    out: list[str] = []
    for corr_cut in CANDIDATE_I_CUTS:
        out += [
            f"### {IMAGE_NAMED_ALBUM} at correlation cut {corr_cut:g}",
            "",
            "| share cut | " + " | ".join(stamps) + " |",
            "| ---: | " + " | ".join("---" for _ in stamps) + " |",
        ]
        for row in [r for r in rows if r["corr_cut"] == corr_cut]:
            cells = " | ".join(row["named"].get(stamp, "none") for stamp in stamps)
            out += [f"| {row['share_cut']:g} | {cells} |"]
        out.append("")
    return out


def _intro() -> str:
    """State what candidate I reads, and which question the share stands in for."""
    folds = " and ".join(f"{hz / 1000:g} kHz" for hz in CANDIDATE_I_FOLDS_HZ)
    return (
        f"Candidate I reads, per frame, the Pearson correlation between that frame's spectrum over the "
        f"{CANDIDATE_I_SPAN_HZ / 1000:g} kHz above a fold and its spectrum over the "
        f"{CANDIDATE_I_SPAN_HZ / 1000:g} kHz below it, reversed so each pair of bins sits the same distance from "
        f"the fold. Both folds are read, {folds}, and the frame takes the larger of the two correlations. A block "
        f"reports the share of its frames whose correlation clears a cut, over the frames carrying one. Every "
        f"graded steady burst of the labelled corpus is scored at {HEADLINE_WINDOW:g} s blocks."
    )


def _grade_intro() -> str:
    """State the policy the grade tables are read under."""
    return (
        f"The share stands in for the mask level line as the first question: a block is kept where its share "
        f"clears the share cut, rather than where its above-fold level clears a dB line. The second question is "
        f"unchanged — a kept block reads junk where G90 clears {POLICY_G90_FIXED_CUT:g} dB and either the "
        f"{MIRROR_VETO_LEVEL:g} dB ratio veto stands down or G90 sits at or above {POLICY_RUN_RULE_YIELD_AT:g} dB, "
        f"yielding the veto. A burst engages on {POLICY_ENGAGE_RUN} consecutive junk blocks, a block the share "
        f"drops breaking the run exactly as a kept block reading real does. A fake burst carrying fewer than "
        f"{POLICY_ENGAGE_RUN} kept blocks cannot engage under any share cut, so it is counted apart; it reads "
        f"`thin` in the per-burst tables."
    )


def write_report(corpus: Corpus, rows: list[dict[str, Any]]) -> None:
    """Write every table to ``REPORT``, each under the command that produced it."""
    lines = [
        "# Image-fold candidate I over the labelled corpus",
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
        f"Produced by `{RUN_CMD}`.",
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
