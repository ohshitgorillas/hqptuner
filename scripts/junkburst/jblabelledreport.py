"""The markdown report for the owner-labelled run, one function per section."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import BY_TRACK, GROUPS, HEADLINE_WINDOW, REPORT, WINDOWS
from jbthresholds import LABEL_CAND_TITLE, LABEL_CANDIDATES, best_guard

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
    lines = _preamble(run) + _guard_section(run) + _group_sections(run) + _album_section(run) + _tail_sections(run)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
