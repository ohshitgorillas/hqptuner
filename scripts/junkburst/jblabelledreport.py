"""The markdown report for the owner-labelled run, one function per section."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import (
    BY_TRACK,
    CANDIDATE_E_REF_HZ,
    GROUPS,
    HEADLINE_WINDOW,
    MASK_ABOVE_HZ,
    MASK_FOLDS_HZ,
    QUIET_MAX_LEVEL_DB,
    REPORT,
    WINDOWS,
)
from jbedge import edge_section
from jbmask import DECILES, MASK_READINGS, MASK_SPLITS, mask_sweep_section
from jbmirror import mirror_section
from jbpolicy import loud_frame_sweep_section, policy_section
from jbpolicyyield import policy_run_rule_diff_table, policy_run_rule_table, policy_yield_block_table
from jbquiet import QUIET_CANDIDATES, SPLITS
from jbthresholds import EN_DASH, LABEL_CAND_TITLE, LABEL_CANDIDATES, best_guard
from jbtilt import tilt_section
from jbveto import real_veto_section

if TYPE_CHECKING:
    from jbrun import LabelledRun

_LABELLED_HEAD = (
    "| window | candidate | threshold | fake side | wrong-side blocks | fake called real | real called fake | "
    "blocks | fake blocks | real blocks |"
)
_GUARD_HEAD = (
    "| guard | threshold | fake side | wrong-side blocks | fake called real | real called fake | "
    "blocks with no reading | blocks |"
)


def _labelled_table(scored_group: dict[float, dict[str, dict[str, Any]]]) -> list[str]:
    """One row per window and candidate: its threshold, which side reads fake, and its wrong-side split."""
    lines = [_LABELLED_HEAD, "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for window in WINDOWS:
        for cand in LABEL_CANDIDATES:
            s = scored_group[window][cand]
            thr = f"{s['threshold']:.4f}" if np.isfinite(s["threshold"]) else "none"
            side = "at or above" if s["fake_high"] else "at or below"
            lines.append(
                f"| {window:g} s | {cand} | {thr} | {side} | {s['wrong']} | {s['fake_called_real']} | "
                f"{s['real_called_fake']} | {s['blocks']} | {s['fake_blocks']} | {s['real_blocks']} |"
            )
    return [*lines, ""]


def _guard_rows(sweep_rows: list[dict[str, Any]]) -> list[str]:
    """One markdown row per guard value."""
    out = []
    for row in sweep_rows:
        thr = f"{row['threshold']:.4f}" if np.isfinite(row["threshold"]) else "none"
        side = "at or above" if row["fake_high"] else "at or below"
        out.append(
            f"| {row['guard']:g} | {thr} | {side} | {row['wrong']} | {row['fake_called_real']} | "
            f"{row['real_called_fake']} | {row['no_reading']} | {row['blocks']} |"
        )
    return out


def _guard_section(run: LabelledRun) -> list[str]:
    """One table per candidate: its NaN guard swept, the threshold re-picked at every guard value."""
    intro = (
        "Each row re-reads the candidate with that guard value and picks the threshold again over the values the "
        "guard leaves. Blocks with no reading read REAL, so a guard that reads less is not free."
    )
    lines = [f"## NaN guard sweep at {HEADLINE_WINDOW:g} s", "", intro, ""]
    for group in GROUPS:
        for cand in ("E2", "E3"):
            unit = "dB of lower-band spread" if cand == "E2" else "dB above the floor"
            best = best_guard(run.guard_sweep[group][cand])
            found = (
                f"Fewest wrong-side blocks at guard {best['guard']:g}: {best['wrong']} of {best['blocks']}, "
                f"{best['no_reading']} blocks carrying no reading."
            )
            lines += [
                f"### {group}, candidate {cand} — guard in {unit}",
                "",
                _GUARD_HEAD,
                "| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
            ]
            lines += _guard_rows(run.guard_sweep[group][cand])
            lines += ["", found, ""]
    return lines


def _preamble(run: LabelledRun) -> list[str]:
    """State what is scored, how a burst takes its label, and what every threshold means."""
    fake = sum(1 for s in run.graded if run.owner[s] == "FAKE")
    real = len(run.graded) - fake
    scope = (
        f"{len(run.graded)} bursts are scored, {fake} FAKE and {real} REAL; {len(run.unlabelled)} carry no label and "
        f"are left out of every table below, and {len(run.duplicates)} more are dropped as duplicate arrivals. Every "
        f"burst takes the label `labels.tsv` gives its artist and album from `tracks.tsv`, with a `{BY_TRACK}` album "
        f"resolved once more by the burst's track title; a burst absent from `tracks.tsv`, or whose row reaches no "
        f"label, is unlabelled."
    )
    rule = (
        "Each candidate's threshold is the value that puts the fewest blocks on the wrong side, swept over that "
        "candidate's own values in both directions. A block with no reading reads REAL. Wrong-side blocks are split "
        "into fake called real and real called fake."
    )
    return [
        "# junkburst block candidates, graded against the owner's labels",
        "",
        scope,
        "",
        rule,
        "",
        *[f"- {cand}: {LABEL_CAND_TITLE[cand]}" for cand in LABEL_CANDIDATES],
        "",
    ]


def _group_sections(run: LabelledRun) -> list[str]:
    """Write the steady table and the transition table, each with the count of bursts behind it."""
    steady = sum(1 for s in run.graded if run.group_of[s] == "steady")
    transition = (
        f"{len(run.graded) - steady} bursts whose `tracks.tsv` row marks `transition=yes`, scored in their own table."
    )
    return [
        "## Steady bursts",
        "",
        f"{steady} bursts whose `tracks.tsv` row does not mark a transition.",
        "",
        *_labelled_table(run.scored["steady"]),
        "## Transition bursts",
        "",
        transition,
        "",
        *_labelled_table(run.scored["transition"]),
    ]


def _album_section(run: LabelledRun) -> list[str]:
    """Per-album wrong-side blocks, each candidate at its own threshold."""
    lines = [
        f"## Per-album wrong-side blocks at {HEADLINE_WINDOW:g} s",
        "",
        "Steady blocks only, each candidate at its own threshold from the table above.",
        "",
        "| album | label | blocks | " + " | ".join(LABEL_CANDIDATES) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in LABEL_CANDIDATES) + " |",
    ]
    for name in sorted(run.albums):
        entry = run.albums[name]
        lines.append(
            f"| {name} | {entry['label']} | {entry['blocks']} | "
            + " | ".join(str(entry["wrong"][c]) for c in LABEL_CANDIDATES)
            + " |"
        )
    return [*lines, ""]


def _split_section(run: LabelledRun) -> list[str]:
    """Write A, G and GC at the headline window over all steady blocks, over the quiet ones, and over the loud ones."""
    intro = (
        f"Steady blocks only. A block is quiet when the 90th percentile of its 15{EN_DASH}18 kHz reference band sits "
        f"under {QUIET_MAX_LEVEL_DB:g} dB in the metering's own dB, and loud otherwise. Each split picks its own cut "
        f"over the values that split leaves."
    )
    lines = [
        f"## Quiet and loud blocks at {HEADLINE_WINDOW:g} s",
        "",
        intro,
        "",
        (
            "| blocks | candidate | cut | fake side | wrong-side blocks | fake called real | real called fake | "
            "held-out wrong | held-out fake called real | held-out real called fake | blocks |"
        ),
        "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for split in SPLITS:
        for cand in QUIET_CANDIDATES:
            s, row = run.split_scored[split][cand], run.loao_split[split][cand]
            cut = f"{s['threshold']:.4f}" if np.isfinite(s["threshold"]) else "none"
            side = "at or above" if s["fake_high"] else "at or below"
            lines.append(
                f"| {split} | {cand} | {cut} | {side} | {s['wrong']} | {s['fake_called_real']} | "
                f"{s['real_called_fake']} | {row['wrong']} | {row['fake_called_real']} | "
                f"{row['real_called_fake']} | {s['blocks']} |"
            )
    return [*lines, ""]


def _loao_section(run: LabelledRun) -> list[str]:
    """Every candidate's leave-one-album-out totals beside its in-sample row, over the steady headline blocks."""
    head = run.scored["steady"][HEADLINE_WINDOW]
    intro = (
        "Steady blocks only. The in-sample columns repeat the cut each candidate picked over every block it then "
        "grades. The leave-one-album-out columns hold each album out in turn, pick the cut over all the other "
        "albums' blocks, grade the held-out album at it, and sum the wrong-side counts over the albums."
    )
    lines = [
        f"## Leave-one-album-out at {HEADLINE_WINDOW:g} s",
        "",
        intro,
        "",
        (
            "| candidate | in-sample wrong | in-sample fake called real | in-sample real called fake | "
            "held-out wrong | held-out fake called real | held-out real called fake | blocks |"
        ),
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for cand in LABEL_CANDIDATES:
        s, row = head[cand], run.loao[cand]
        lines.append(
            f"| {cand} | {s['wrong']} | {s['fake_called_real']} | {s['real_called_fake']} "
            f"| {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} | {row['blocks']} |"
        )
    return [*lines, "", *_loao_album_rows(run)]


def _loao_album_rows(run: LabelledRun) -> list[str]:
    """Per album, G's and H's wrong-side blocks in sample and held out, for every album either puts one wrong."""
    lines = [
        f"### Per-album wrong blocks for G and H at {HEADLINE_WINDOW:g} s",
        "",
        "Every album carrying a wrong block under G or H, in sample or held out.",
        "",
        "| album | label | blocks | G in sample | H in sample | G held out | H held out |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in sorted(run.albums):
        entry = run.albums[name]
        counts = [
            entry["wrong"]["G"],
            entry["wrong"]["H"],
            run.loao["G"]["albums"].get(name, 0),
            run.loao["H"]["albums"].get(name, 0),
        ]
        if not any(counts):
            continue
        row = " | ".join(str(c) for c in counts)
        lines.append(f"| {name} | {entry['label']} | {entry['blocks']} | {row} |")
    return [*lines, ""]


def _quiet_album_section(run: LabelledRun) -> list[str]:
    """Per album over the quiet steady blocks: how many, how many G puts wrong, and G's median value there."""
    lines = [
        f"## Per-album G on quiet blocks at {HEADLINE_WINDOW:g} s",
        "",
        "Quiet steady blocks only, G at the cut the quiet split picked.",
        "",
        "| album | label | blocks | wrong | median G |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for name in sorted(run.quiet_albums):
        entry = run.quiet_albums[name]
        median = f"{entry['median']:.2f}" if np.isfinite(entry["median"]) else "none"
        lines.append(f"| {name} | {entry['label']} | {entry['blocks']} | {entry['wrong']} | {median} |")
    return [*lines, ""]


def _a_missed_section(run: LabelledRun) -> list[str]:
    """Per album: the FAKE blocks A calls real, split into blocks with no reading and blocks with one below the cut."""
    thr = run.scored["steady"][HEADLINE_WINDOW]["A"]
    side = (
        "A reads fake at or above its cut, so every wrong fake block carrying a reading sits below it."
        if thr["fake_high"]
        else "A reads fake at or below its cut, so the second column counts blocks whose reading sits above it."
    )
    lines = [
        f"## Per-album fake blocks A calls real at {HEADLINE_WINDOW:g} s",
        "",
        f"Steady blocks only, at A's own cut from the table above. {side}",
        "",
        "| album | no reading | reading below the cut |",
        "| --- | ---: | ---: |",
    ]
    for name in sorted(run.a_missed):
        entry = run.a_missed[name]
        lines.append(f"| {name} | {entry['no_reading']} | {entry['below_cut']} |")
    return [*lines, ""]


def _mask_cell(reading: str, value: float) -> str:
    """One mask cell: three decimals for a correlation, two for a level in dB, blank-free ``none`` for no reading."""
    if not np.isfinite(value):
        return "none"
    return f"{value:.3f}" if reading == "correlation" else f"{value:.2f}"


def _mask_decile_rows(run: LabelledRun) -> list[str]:
    """One row per reading and split: how many blocks carry it, and p0 to p100 of it over them."""
    out = []
    for reading in MASK_READINGS:
        for split in MASK_SPLITS:
            entry = run.mask_deciles[reading][split]
            cells = [_mask_cell(reading, v) for v in entry["deciles"]] or ["none"] * len(DECILES)
            out.append(f"| {reading} | {split} | {entry['blocks']} | " + " | ".join(cells) + " |")
    return out


def _mask_album_rows(run: LabelledRun) -> list[str]:
    """One row per album: its label, its steady headline blocks, and the median of all three readings."""
    out = []
    for name in sorted(run.mask_albums):
        entry = run.mask_albums[name]
        medians = " | ".join(_mask_cell(r, entry["median"][r]) for r in MASK_READINGS)
        out.append(f"| {name} | {entry['label']} | {entry['blocks']} | {medians} |")
    return out


def _mask_section(run: LabelledRun) -> list[str]:
    """Write the mask reading over the steady headline blocks: its deciles by split, then its per-album medians."""
    folds = " and ".join(f"{hz / 1000:g} kHz" for hz in MASK_FOLDS_HZ)
    intro = (
        f"Steady blocks only. Each frame's summed-channel power is normalised to per-Hz, and the block's above-fold "
        f"level is the median across its frames of the mean level in dB from {MASK_ABOVE_HZ[0]:g} Hz above the fold "
        f"to {MASK_ABOVE_HZ[1] / 1000:g} kHz above it. The music level is the same over "
        f"{CANDIDATE_E_REF_HZ[0] / 1000:g}{EN_DASH}{CANDIDATE_E_REF_HZ[1] / 1000:g} kHz, the ratio is the above-fold "
        f"level minus it in dB, and the correlation is Pearson across the block's frames between the two band "
        f"levels. Both folds at {folds} are read and the one with the higher above-fold level is the block's "
        f"reading. The quiet and loud split is the same tag the section above uses."
    )
    head = "| reading | blocks set | blocks | " + " | ".join(f"p{p}" for p in DECILES) + " |"
    lines = [
        "## Mask",
        "",
        intro,
        "",
        head,
        "| --- | --- | ---: | " + " | ".join("---:" for _ in DECILES) + " |",
        *_mask_decile_rows(run),
        "",
        f"### Per-album mask medians at {HEADLINE_WINDOW:g} s",
        "",
        "Steady blocks only, every block of the album pooled.",
        "",
        "| album | label | blocks | " + " | ".join(f"median {r}" for r in MASK_READINGS) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in MASK_READINGS) + " |",
        *_mask_album_rows(run),
    ]
    return [*lines, ""]


def _tail_sections(run: LabelledRun) -> list[str]:
    """List the duplicate arrivals dropped, and the bursts nothing labels."""
    dupes = (
        f"{len(run.duplicates)} bursts whose 5 s span of arrival time overlaps a burst already kept, so the same "
        f"audio is scored once rather than twice. The earliest stamp of each overlapping run is the one kept."
    )
    return [
        "## Duplicate bursts",
        "",
        dupes,
        "",
        "| dropped burst | duplicates |",
        "| --- | --- |",
        *[f"| {row['stamp']} | {row['duplicates']} |" for row in run.duplicates],
        "",
        "## Bursts with no label",
        "",
        f"{len(run.unlabelled)} bursts, counted and left out of the scoring above.",
        "",
        *[f"- {stamp}" for stamp in run.unlabelled],
        "",
    ]


def write_labelled_report(run: LabelledRun) -> None:
    """Write every section of the owner-labelled report to ``REPORT``."""
    lines = (
        _preamble(run)
        + _guard_section(run)
        + _group_sections(run)
        + _split_section(run)
        + _loao_section(run)
        + _album_section(run)
        + _quiet_album_section(run)
        + _mask_section(run)
        + mask_sweep_section(run)
        + real_veto_section(run)
        + mirror_section(run)
        + edge_section(run)
        + loud_frame_sweep_section(run)
        + policy_section(run)
        + policy_yield_block_table(run)
        + policy_run_rule_table(run)
        + policy_run_rule_diff_table(run)
        + tilt_section(run)
        + _a_missed_section(run)
        + _tail_sections(run)
    )
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
