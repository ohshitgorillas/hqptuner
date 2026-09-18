"""The burst-level junk policy: G90 against a fixed cut, the rules graded per burst, and their report sections."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbedge import edge_cell
from jbmask import MASK_SWEEP_ALBUM_LEVEL, MASK_SWEEP_CANDIDATE, sweep_keep
from jbmirror import MIRROR_VETO_LEVEL
from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from jbrun import LabelledRun, MaskRow


#: The fixed G90 cuts the loud-frame step sweep reads, in dB.
LOUD_FRAME_CUTS = (8.0, 9.0, 10.0, 11.0, 12.0, 14.0)


def _loud_frame_call(mask_row: MaskRow, g90_value: float, cut: float) -> bool:
    """One block's verdict at a fixed G90 cut, forced real when its ratio sits at or above the mirror veto line."""
    if np.isfinite(mask_row[3]) and mask_row[3] >= MIRROR_VETO_LEVEL:
        return False
    return np.isfinite(g90_value) and g90_value >= cut


def loud_frame_cut_row(
    mask_rows: list[MaskRow], g90_rows: list[tuple[str, float, str]], row_key_of: dict[str, str], cut: float
) -> dict[str, Any]:
    """One G90 cut over the kept blocks: its wrong-side counts, and the wrong count per album or track row key."""
    rows: dict[str, int] = {}
    total: dict[str, Any] = {"cut": float(cut), "wrong": 0, "fake_called_real": 0, "real_called_fake": 0}
    for mask_row, (stamp, value, label) in zip(mask_rows, g90_rows, strict=True):
        is_fake = label == "FAKE"
        if _loud_frame_call(mask_row, value, cut) == is_fake:
            continue
        total["wrong"] += 1
        total["fake_called_real" if is_fake else "real_called_fake"] += 1
        rows[row_key_of[stamp]] = rows.get(row_key_of[stamp], 0) + 1
    total["rows"] = rows
    return total


def loud_frame_sweep(run: LabelledRun) -> list[dict[str, Any]]:
    """One row per ``LOUD_FRAME_CUTS`` value, over the blocks the album line keeps at the headline window.

    G90 alone against a fixed cut, no per-album fitting, the mirror ratio veto forcing a block real whatever the
    cut says; the same kept blocks ``edge_tables`` reads.
    """
    mask_rows: list[MaskRow] = run.mask["steady"][HEADLINE_WINDOW]
    g90_rows = run.edge["steady"]["G90"]
    keep = sweep_keep(mask_rows, MASK_SWEEP_ALBUM_LEVEL)
    kept_mask = [mask_rows[i] for i in keep]
    kept_g90 = [g90_rows[i] for i in keep]
    return [loud_frame_cut_row(kept_mask, kept_g90, run.row_key_of, cut) for cut in LOUD_FRAME_CUTS]


def loud_frame_sweep_section(run: LabelledRun) -> list[str]:
    """Return the report's loud-frame step sweep section: one table per ``LOUD_FRAME_CUTS`` cut."""
    intro = (
        f"Over the blocks the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s. Each row is G90 "
        f"read against the fixed cut alone — no per-album fitting — with the {MIRROR_VETO_LEVEL:g} dB ratio veto "
        f"forcing a block real whatever G90 says. The per-row table under each cut lists every album or track row "
        f"key carrying at least one wrong block there, and how many."
    )
    head = "| cut | wrong | fake called real | real called fake |"
    rows = [
        f"| {row['cut']:g} dB | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.loud_frame_sweep
    ]
    out = ["## Loud-frame step sweep", "", intro, "", head, "| --- | ---: | ---: | ---: |", *rows, ""]
    for row in run.loud_frame_sweep:
        out += [f"### {row['cut']:g} dB", "", "| album or track | wrong |", "| --- | ---: |"]
        out += [f"| {name} | {count} |" for name, count in sorted(row["rows"].items())]
        out.append("")
    return out


#: The fixed G90 cut the policy grade reads its second rule at, in dB.
POLICY_G90_FIXED_CUT = 11.0
#: How many consecutive junk blocks engage a burst.
POLICY_ENGAGE_RUN = 2
#: The row key the per-block table is written for.
POLICY_BLOCK_KEY = "Lateralus"
#: The five graded rules, in the order every table below carries them.
POLICY_RULES = (
    "G at its in-sample cut",
    f"G90 at {POLICY_G90_FIXED_CUT:g} dB",
    "G90 at its leave-one-album-out cut",
    "both fire",
    "either fires",
)


#: The veto lines G90 at its fixed cut is additionally graded under, beyond ``MIRROR_VETO_LEVEL`` and no veto.
POLICY_G90_VETO_LEVELS = (-8.0, -10.0, -12.0, -18.0, -21.0)


def _veto_forces_real(mask_row: MaskRow, veto: float) -> bool:
    """Report whether the block's ratio sits at or above the veto line, forcing it real whatever a cut says."""
    return bool(np.isfinite(mask_row[3]) and mask_row[3] >= veto)


def _veto_label(veto: float | None) -> str:
    """Name a veto line for a rule row's heading: the dB line, or that no veto applies."""
    return "no veto" if veto is None else f"{veto:g} dB veto"


def _in_sample_calls(rows: list[tuple[str, float, str]], keep: list[int]) -> dict[int, bool]:
    """Per kept block: the call of a cut picked over those same kept blocks."""
    thr = best_threshold([rows[i][1] for i in keep], [rows[i][2] for i in keep])
    return {i: calls_fake(rows[i][1], thr) for i in keep}


def _loao_calls(rows: list[tuple[str, float, str]], album_of: dict[str, str], keep: list[int]) -> dict[int, bool]:
    """Per kept block: the call of a cut picked over every other album's kept blocks."""
    by_album: dict[str, list[int]] = {}
    for i in keep:
        by_album.setdefault(album_of[rows[i][0]], []).append(i)
    out = dict.fromkeys(keep, False)
    for held in by_album.values():
        rest = [i for i in keep if i not in set(held)]
        if not rest:
            continue
        thr = best_threshold([rows[i][1] for i in rest], [rows[i][2] for i in rest])
        for i in held:
            out[i] = calls_fake(rows[i][1], thr)
    return out


def _fixed_calls(rows: list[tuple[str, float, str]], keep: list[int], cut: float) -> dict[int, bool]:
    """Per kept block: whether its reading sits at or above a fixed cut."""
    return {i: bool(np.isfinite(rows[i][1]) and rows[i][1] >= cut) for i in keep}


@dataclass(frozen=True)
class PolicyBlocks:
    """The steady-burst blocks a policy pass grades: their mask rows, G and G90 readings, albums and keep set."""

    mask_rows: list[MaskRow]
    g_rows: list[tuple[str, float, str]]
    g90_rows: list[tuple[str, float, str]]
    album_of: dict[str, str]
    keep: list[int]


def policy_junk(
    blocks: PolicyBlocks, *, veto: float | None, rules: tuple[str, ...] = POLICY_RULES
) -> dict[str, dict[int, bool]]:
    """Per rule, per kept block: whether it reads junk, its cut cleared and the given veto line not forcing it real."""
    keep = blocks.keep
    g = _in_sample_calls(blocks.g_rows, keep)
    fixed = _fixed_calls(blocks.g90_rows, keep, POLICY_G90_FIXED_CUT)
    held = _loao_calls(blocks.g90_rows, blocks.album_of, keep)
    calls = dict(
        zip(
            POLICY_RULES,
            [g, fixed, held, {i: g[i] and held[i] for i in keep}, {i: g[i] or held[i] for i in keep}],
            strict=True,
        )
    )
    return {
        rule: {
            i: calls[rule][i] and not (veto is not None and _veto_forces_real(blocks.mask_rows[i], veto)) for i in keep
        }
        for rule in rules
    }


def _engages(junk: dict[int, bool], blocks: list[int]) -> bool:
    """Report whether the burst carries ``POLICY_ENGAGE_RUN`` consecutive blocks reading junk.

    A block the album line drops is not junk, so it breaks the run exactly as a kept block reading real does.
    """
    length = 0
    for i in blocks:
        length = length + 1 if junk.get(i, False) else 0
        if length >= POLICY_ENGAGE_RUN:
            return True
    return False


def policy_bursts(mask_rows: list[MaskRow]) -> dict[str, list[int]]:
    """Per burst stamp: its block indices at the headline window, in the order the run scored them."""
    out: dict[str, list[int]] = {}
    for i, row in enumerate(mask_rows):
        out.setdefault(row[0], []).append(i)
    return out


def policy_rule_row(
    rule: str,
    junk: dict[int, bool],
    bursts: dict[str, list[int]],
    kept: set[int],
    run: LabelledRun,
) -> dict[str, Any]:
    """One rule's burst counts, and the stamps of its engaged real bursts and its missed fake bursts per row key."""
    row: dict[str, Any] = {"rule": rule, "real_engaged": 0, "fake_engaged": 0, "fake_missed": 0, "fake_thin": 0}
    rows: dict[str, dict[str, list[str]]] = {}
    for stamp, blocks in bursts.items():
        engaged = _engages(junk, blocks)
        entry = rows.setdefault(run.row_key_of[stamp], {"engaged_real": [], "missed_fake": []})
        if run.owner[stamp] != "FAKE":
            if engaged:
                row["real_engaged"] += 1
                entry["engaged_real"].append(stamp)
        elif sum(1 for i in blocks if i in kept) < POLICY_ENGAGE_RUN:
            row["fake_thin"] += 1
        elif engaged:
            row["fake_engaged"] += 1
        else:
            row["fake_missed"] += 1
            entry["missed_fake"].append(stamp)
    row["rows"] = {key: entry for key, entry in rows.items() if entry["engaged_real"] or entry["missed_fake"]}
    return row


def policy_block_rows(
    mask_rows: list[MaskRow], g90_rows: list[tuple[str, float, str]], keep: list[int], run: LabelledRun
) -> list[dict[str, Any]]:
    """One row per kept block of the bursts ``POLICY_BLOCK_KEY`` names: its stamp, index, ratio, G90 and veto."""
    within = {i: n for blocks in policy_bursts(mask_rows).values() for n, i in enumerate(blocks)}
    out = []
    for i in keep:
        stamp = mask_rows[i][0]
        if POLICY_BLOCK_KEY not in run.row_key_of[stamp]:
            continue
        out.append(
            {
                "stamp": stamp,
                "index": within[i],
                "ratio": float(mask_rows[i][3]),
                "g90": float(g90_rows[i][1]),
                "veto": _veto_forces_real(mask_rows[i], MIRROR_VETO_LEVEL),
            }
        )
    return out


#: (veto line, rules graded under it) for every pass ``policy_grade`` runs: all five rules twice, then the fixed
#: G90 rule alone under each of ``POLICY_G90_VETO_LEVELS``.
POLICY_PASSES: tuple[tuple[float | None, tuple[str, ...]], ...] = (
    (MIRROR_VETO_LEVEL, POLICY_RULES),
    (None, POLICY_RULES),
    *((v, (POLICY_RULES[1],)) for v in POLICY_G90_VETO_LEVELS),
)


def policy_grade(run: LabelledRun) -> dict[str, Any]:
    """Grade every rule per unique steady burst under each veto pass, and read the per-block table."""
    mask_rows: list[MaskRow] = run.mask["steady"][HEADLINE_WINDOW]
    g_rows = run.rows["steady"][HEADLINE_WINDOW][MASK_SWEEP_CANDIDATE]
    g90_rows = run.edge["steady"]["G90"]
    keep = sweep_keep(mask_rows, MASK_SWEEP_ALBUM_LEVEL)
    bursts = policy_bursts(mask_rows)
    kept = set(keep)
    blocks = PolicyBlocks(mask_rows, g_rows, g90_rows, run.album_of, keep)
    rows = []
    for veto, rules in POLICY_PASSES:
        junk = policy_junk(blocks, veto=veto, rules=rules)
        for rule in rules:
            row = policy_rule_row(rule, junk[rule], bursts, kept, run)
            row["rule"] = f"{rule} ({_veto_label(veto)})"
            rows.append(row)
    return {
        "bursts": len(bursts),
        "rules": rows,
        "blocks": policy_block_rows(mask_rows, g90_rows, keep, run),
    }


def _policy_intro() -> str:
    """State the policy every rule is graded under, and which cut each rule reads."""
    return (
        f"One row per unique steady burst at {HEADLINE_WINDOW:g} s. A block reads junk only when the "
        f"{MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps it, the row's veto line does not force it real, and the rule "
        f"under test clears its cut; a burst engages when {POLICY_ENGAGE_RUN} consecutive blocks read junk, a "
        f"dropped block breaking the run. The last two of the five rules read G at its in-sample cut against G90 "
        f"at its leave-one-album-out cut. Every rule is graded twice, once under the {MIRROR_VETO_LEVEL:g} dB ratio "
        f"veto and once with no veto at all; G90 at its fixed cut is graded again under each of "
        f"{', '.join(f'{v:g}' for v in POLICY_G90_VETO_LEVELS)} dB. A fake burst carrying fewer than "
        f"{POLICY_ENGAGE_RUN} kept blocks cannot engage under any rule, so it is counted apart rather than against "
        f"the rule."
    )


def _policy_row_tables(row: dict[str, Any]) -> list[str]:
    """One rule's per-album-or-track table: its engaged real bursts and its missed fake bursts, with stamps."""
    out = [
        f"### {row['rule']}",
        "",
        "| album or track | engaged real bursts | missed fake bursts |",
        "| --- | --- | --- |",
    ]
    for key, entry in sorted(row["rows"].items()):
        real = " ".join(entry["engaged_real"]) or "none"
        fake = " ".join(entry["missed_fake"]) or "none"
        out.append(f"| {key} | {real} | {fake} |")
    return [*out, ""]


def _policy_block_table(run: LabelledRun) -> list[str]:
    """Return the per-block table for the bursts ``POLICY_BLOCK_KEY`` names, over the blocks the album line keeps."""
    blocks = run.policy_grade["blocks"]
    intro = (
        f"Every block of {POLICY_BLOCK_KEY} the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s, "
        f"{len(blocks)} of them. The last column reads yes where the ratio sits at or above "
        f"{MIRROR_VETO_LEVEL:g} dB and the veto forces the block real."
    )
    rows = [
        f"| {b['stamp']} | {b['index']} | {b['ratio']:.1f} | {edge_cell('G90', b['g90'])} | "
        f"{'yes' if b['veto'] else 'no'} |"
        for b in blocks
    ]
    return [
        f"### {POLICY_BLOCK_KEY} blocks",
        "",
        intro,
        "",
        "| stamp | block | ratio (dB) | G90 (dB) | veto forces real |",
        "| --- | ---: | ---: | ---: | --- |",
        *rows,
        "",
    ]


def policy_section(run: LabelledRun) -> list[str]:
    """Return the report's policy grade section: the five rules' burst counts, their row tables, then the blocks."""
    head = (
        "| rule | real bursts engaged | fake bursts engaged | fake bursts missed | "
        f"fake bursts under {POLICY_ENGAGE_RUN} kept blocks |"
    )
    rows = [
        f"| {row['rule']} | {row['real_engaged']} | {row['fake_engaged']} | {row['fake_missed']} | "
        f"{row['fake_thin']} |"
        for row in run.policy_grade["rules"]
    ]
    out = [
        "## Policy grade",
        "",
        _policy_intro(),
        "",
        head,
        "| --- | ---: | ---: | ---: | ---: |",
        *rows,
        "",
    ]
    for row in run.policy_grade["rules"]:
        out += _policy_row_tables(row)
    return [*out, *_policy_block_table(run)]
