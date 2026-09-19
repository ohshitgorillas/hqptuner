"""The G90-at-11-dB veto-yield rule family: a loud-frame step high enough forces the ratio veto to stand down."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, NamedTuple

import numpy as np
from jbedge import edge_cell
from jbmask import MASK_SWEEP_ALBUM_LEVEL
from jbmirror import MIRROR_VETO_LEVEL
from jbpolicy import (
    POLICY_ENGAGE_RUN,
    POLICY_G90_FIXED_CUT,
    POLICY_RULES,
    PolicyBlocks,
    policy_bursts,
    policy_grade_context,
    policy_rule_row,
)

if TYPE_CHECKING:
    from jbrun import LabelledRun, MaskRow


#: The loud-frame step lines that force the ``MIRROR_VETO_LEVEL`` ratio veto to yield, engaging the block whatever
#: its ratio reads.
POLICY_G90_YIELD_LEVELS = (12.0, 13.0, 14.0, 16.0, 20.0)
#: The burst stamps the block-level table names outright, before the one Meddle burst it finds by lookup.
POLICY_YIELD_BLOCK_STAMPS = (
    "20260917T114252Z",
    "20260917T114703Z",
    "20260917T114909Z",
    "20260918T224438Z",
    "20260918T224849Z",
)
#: The loud-frame step line the block-level table's verdict column reads.
POLICY_YIELD_BLOCK_S = 13.0


def _yield_veto_forces_real(mask_row: MaskRow) -> bool:
    """Report whether the block's ratio sits at or above ``MIRROR_VETO_LEVEL``, forcing it real."""
    return bool(np.isfinite(mask_row[3]) and mask_row[3] >= MIRROR_VETO_LEVEL)


def _fixed_yield_calls(blocks: PolicyBlocks, yield_at: float) -> dict[int, bool]:
    """Per kept block: G90 clears its cut, and the ratio veto either stands down or yields to ``yield_at``."""
    return {
        i: np.isfinite(blocks.g90_rows[i][1])
        and blocks.g90_rows[i][1] >= POLICY_G90_FIXED_CUT
        and (not _yield_veto_forces_real(blocks.mask_rows[i]) or blocks.g90_rows[i][1] >= yield_at)
        for i in blocks.keep
    }


def policy_yield_grade(
    blocks: PolicyBlocks, bursts: dict[str, list[int]], kept: set[int], run: LabelledRun
) -> list[dict[str, Any]]:
    """One graded row per ``POLICY_G90_YIELD_LEVELS`` line, in the same shape ``policy_rule_row`` returns."""
    out = []
    for yield_at in POLICY_G90_YIELD_LEVELS:
        row = policy_rule_row(POLICY_RULES[1], _fixed_yield_calls(blocks, yield_at), bursts, kept, run)
        row["rule"] = f"{POLICY_RULES[1]} ({MIRROR_VETO_LEVEL:g} dB veto yielding at {yield_at:g} dB)"
        out.append(row)
    return out


def _meddle_yield_stamp(rows: list[dict[str, Any]]) -> str:
    """Find the stamp the ``G90 at 11 dB (no veto)`` rule engages under a row key naming Meddle."""
    target = f"{POLICY_RULES[1]} (no veto)"
    for row in rows:
        if row["rule"] != target:
            continue
        for key, entry in row["rows"].items():
            if "Meddle" in key and entry["engaged_real"]:
                return str(entry["engaged_real"][0])
    raise ValueError("no Meddle burst engaged under G90 at 11 dB (no veto)")


def policy_yield_block_rows(
    mask_rows: list[MaskRow], g90_rows: list[tuple[str, float, str]], keep: list[int], rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """One row per 1 s block of the named bursts and the one Meddle burst the no-veto fixed rule engages."""
    stamps = (*POLICY_YIELD_BLOCK_STAMPS, _meddle_yield_stamp(rows))
    kept = set(keep)
    bursts = policy_bursts(mask_rows)
    out = []
    for stamp in stamps:
        for n, i in enumerate(bursts.get(stamp, [])):
            g90_value = g90_rows[i][1]
            is_kept = i in kept
            verdict = (
                is_kept
                and np.isfinite(g90_value)
                and g90_value >= POLICY_G90_FIXED_CUT
                and (not _yield_veto_forces_real(mask_rows[i]) or g90_value >= POLICY_YIELD_BLOCK_S)
            )
            out.append(
                {
                    "stamp": stamp,
                    "index": n,
                    "kept": is_kept,
                    "g90": float(g90_value),
                    "ratio": float(mask_rows[i][3]),
                    "verdict": bool(verdict),
                }
            )
    return out


#: The working yield line the run rule sweep is fixed at: G90 at 11 dB, veto yielding at 14 dB.
POLICY_RUN_RULE_YIELD_AT = 14.0
#: The maximum block gap between the run rule's two confirming kept blocks, swept.
POLICY_RUN_RULE_GAPS = (1, 2, 3, 5)
#: The consecutive dropped blocks the run rule holds engaged through, swept; ``None`` is unbounded.
POLICY_RUN_RULE_HOLDS: tuple[int | None, ...] = (None, 3, 5)


def _run_rule_scan(
    junk: dict[int, bool], kept: set[int], blocks: list[int], max_gap: int, hold: int | None
) -> tuple[bool, int]:
    """Scan one burst's blocks for the confirming-run-hold rule.

    A dropped block neither confirms nor breaks the run: it is invisible to the gap and to the veto-real break, but
    once a first confirming kept block is seen, a stretch of dropped blocks longer than ``hold`` still resets the
    search. Report whether the burst engages, and the count of dropped blocks folded into the engaging window.
    """
    pending = False
    gap = 0
    drop_run = 0
    window_noop = 0
    for i in blocks:
        if not pending:
            if i in kept and junk.get(i, False):
                pending, gap, drop_run, window_noop = True, 0, 0, 0
            continue
        gap += 1
        if i not in kept:
            drop_run += 1
            window_noop += 1
            if (hold is not None and drop_run > hold) or gap > max_gap:
                pending, gap, drop_run, window_noop = False, 0, 0, 0
            continue
        drop_run = 0
        if gap > max_gap:
            pending, gap, window_noop = junk.get(i, False), 0, 0
        elif junk.get(i, False):
            return True, window_noop
        else:
            pending, gap, window_noop = False, 0, 0
    return False, 0


class _RunRuleCorpus(NamedTuple):
    """The fixed inputs one gap/hold sweep tallies against."""

    junk: dict[int, bool]
    kept: set[int]
    bursts: dict[str, list[int]]
    run: LabelledRun


def _run_rule_tally(corpus: _RunRuleCorpus, max_gap: int, hold: int | None) -> dict[str, Any]:
    """One graded row for a single gap/hold combination, folding every burst's engagement."""
    row: dict[str, Any] = {
        "gap": max_gap,
        "hold": hold,
        "real_engaged": 0,
        "fake_engaged": 0,
        "fake_missed": 0,
        "noop_fake": 0,
    }
    for stamp, block_list in corpus.bursts.items():
        engaged, noop = _run_rule_scan(corpus.junk, corpus.kept, block_list, max_gap, hold)
        if corpus.run.owner[stamp] != "FAKE":
            if engaged:
                row["real_engaged"] += 1
            continue
        if sum(1 for i in block_list if i in corpus.kept) < POLICY_ENGAGE_RUN:
            continue
        if engaged:
            row["fake_engaged"] += 1
            row["noop_fake"] += noop
        else:
            row["fake_missed"] += 1
    return row


def policy_run_rule_grade(
    blocks: PolicyBlocks, bursts: dict[str, list[int]], kept: set[int], run: LabelledRun
) -> list[dict[str, Any]]:
    """One graded row per gap/hold combination the run rule sweeps, at the working G90-at-11-dB, 14 dB yield line."""
    corpus = _RunRuleCorpus(_fixed_yield_calls(blocks, POLICY_RUN_RULE_YIELD_AT), kept, bursts, run)
    return [
        _run_rule_tally(corpus, max_gap, hold) for max_gap in POLICY_RUN_RULE_GAPS for hold in POLICY_RUN_RULE_HOLDS
    ]


#: The two gap lines the per-burst diff table names, and the third it also reports alongside them.
POLICY_RUN_RULE_DIFF_GAPS = (1, 2, 3)
#: The burst the diff table carries outright, whatever its verdicts, beside the ones the gap 1 vs gap 3 diff finds.
POLICY_RUN_RULE_NAMED_STAMP = "20260918T050041Z"


def _run_rule_diff_readings(blocks: PolicyBlocks, block_list: list[int]) -> list[str]:
    """Every kept block of a burst, its position, loud-frame step, ratio and junk-or-real reading at the yield line."""
    junk = _fixed_yield_calls(blocks, POLICY_RUN_RULE_YIELD_AT)
    return [
        f"{n}:{'junk' if junk.get(i, False) else 'real'} (G90 {blocks.g90_rows[i][1]:.1f} dB, "
        f"ratio {blocks.mask_rows[i][3]:.1f} dB)"
        for n, i in enumerate(block_list)
        if i in blocks.keep
    ]


def _run_rule_diff_row(blocks: PolicyBlocks, stamp: str, block_list: list[int]) -> dict[str, Any]:
    """One diff-table row for a burst: its stamp, album, kept-block readings, and verdicts at gap 1, 2 and 3."""
    junk = _fixed_yield_calls(blocks, POLICY_RUN_RULE_YIELD_AT)
    kept = set(blocks.keep)
    verdicts = {g: _run_rule_scan(junk, kept, block_list, g, None)[0] for g in POLICY_RUN_RULE_DIFF_GAPS}
    return {
        "stamp": stamp,
        "album": blocks.album_of[stamp],
        "readings": _run_rule_diff_readings(blocks, block_list),
        "verdicts": verdicts,
    }


def policy_run_rule_diff_rows(
    blocks: PolicyBlocks, bursts: dict[str, list[int]], kept: set[int], run: LabelledRun
) -> list[dict[str, Any]]:
    """Fake bursts whose run rule verdict differs between gap 1 and gap 3, plus the burst named outright."""
    junk = _fixed_yield_calls(blocks, POLICY_RUN_RULE_YIELD_AT)
    out = []
    for stamp, block_list in bursts.items():
        if stamp == POLICY_RUN_RULE_NAMED_STAMP:
            continue
        if run.owner[stamp] != "FAKE":
            continue
        if sum(1 for i in block_list if i in kept) < POLICY_ENGAGE_RUN:
            continue
        verdicts = {g: _run_rule_scan(junk, kept, block_list, g, None)[0] for g in POLICY_RUN_RULE_DIFF_GAPS}
        if verdicts[1] == verdicts[3]:
            continue
        out.append(_run_rule_diff_row(blocks, stamp, block_list))
    out.append(_run_rule_diff_row(blocks, POLICY_RUN_RULE_NAMED_STAMP, bursts[POLICY_RUN_RULE_NAMED_STAMP]))
    return out


def policy_run_rule_diff_table(run: LabelledRun) -> list[str]:
    """Return the diff table: fake bursts whose run rule verdict flips between gap 1 and gap 3, plus one named."""
    intro = (
        "Gap counts index distance between the two confirming kept blocks, not the number of blocks lying between "
        "them: two confirming blocks next to each other, at consecutive indices, read gap 1. Hold is unbounded "
        f"throughout, at the working yield line (G90 at {POLICY_G90_FIXED_CUT:g} dB, {MIRROR_VETO_LEVEL:g} dB veto "
        f"yielding at {POLICY_RUN_RULE_YIELD_AT:g} dB). Kept blocks list index:reading with the block's loud-frame "
        f"step and ratio, for every block the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps, in burst order; a dropped "
        f"block has no entry. The last row, {POLICY_RUN_RULE_NAMED_STAMP}, is carried outright, whatever its "
        "verdicts."
    )
    rows = [
        f"| {r['stamp']} | {r['album']} | {', '.join(r['readings'])} | "
        f"{'engage' if r['verdicts'][1] else 'no'} | {'engage' if r['verdicts'][2] else 'no'} | "
        f"{'engage' if r['verdicts'][3] else 'no'} |"
        for r in run.policy_grade["run_rule_diff"]
    ]
    return [
        "### Run rule gap 1 vs gap 3 diff",
        "",
        intro,
        "",
        "| stamp | album | kept blocks (index:reading, G90, ratio) | gap 1 | gap 2 | gap 3 |",
        "| --- | --- | --- | --- | --- | --- |",
        *rows,
        "",
    ]


def policy_run_rule_table(run: LabelledRun) -> list[str]:
    """Return the run rule's grade table: one row per gap/hold combination at the working yield line."""
    intro = (
        f"The run rule at G90 at {POLICY_G90_FIXED_CUT:g} dB, the {MIRROR_VETO_LEVEL:g} dB ratio veto yielding at "
        f"{POLICY_RUN_RULE_YIELD_AT:g} dB. A confirming block is a kept block reading junk per that line; a dropped "
        f"block neither confirms nor breaks the run. The run engages on two confirming kept blocks at most `gap` "
        f"blocks apart, holds through up to `hold` consecutive dropped blocks once engaged, and drops on the first "
        f"kept block that reads real. No-op counts dropped blocks folded into an engaging window on a fake burst."
    )
    rows = [
        f"| {row['gap']} | {'unbounded' if row['hold'] is None else row['hold']} | {row['real_engaged']} | "
        f"{row['fake_engaged']} | {row['fake_missed']} | {row['noop_fake']} |"
        for row in run.policy_grade["run_rule"]
    ]
    return [
        "### Run rule sweep",
        "",
        intro,
        "",
        "| gap | hold | Real engaged | Fake engaged | Fake missed | no-op blocks engaged (fake) |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
        *rows,
        "",
    ]


def policy_yield_augment(run: LabelledRun) -> None:
    """Grow ``run.policy_grade`` with the yield rule rows, the run rule sweep, and their block-level table rows."""
    blocks, bursts, kept, mask_rows, g90_rows, keep = policy_grade_context(run)
    run.policy_grade["rules"] += policy_yield_grade(blocks, bursts, kept, run)
    run.policy_grade["run_rule"] = policy_run_rule_grade(blocks, bursts, kept, run)
    run.policy_grade["run_rule_diff"] = policy_run_rule_diff_rows(blocks, bursts, kept, run)
    run.policy_grade["yield_blocks"] = policy_yield_block_rows(mask_rows, g90_rows, keep, run.policy_grade["rules"])


def policy_yield_block_table(run: LabelledRun) -> list[str]:
    """Return the yield rule's block-level table: kept or dropped, loud-frame step, ratio, verdict at S = 13 dB."""
    blocks = run.policy_grade["yield_blocks"]
    intro = (
        f"Every 1 s block of the bursts this table names, whether the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps or "
        f"drops it. Verdict reads engage where G90 clears {POLICY_G90_FIXED_CUT:g} dB and either the "
        f"{MIRROR_VETO_LEVEL:g} dB ratio veto stands down or the block's own loud-frame step sits at or above "
        f"{POLICY_YIELD_BLOCK_S:g} dB, yielding the veto; a dropped block never engages."
    )
    rows = [
        f"| {b['stamp']} | {b['index']} | {'kept' if b['kept'] else 'dropped'} | {edge_cell('G90', b['g90'])} | "
        f"{b['ratio']:.1f} | {'engage' if b['verdict'] else 'no'} |"
        for b in blocks
    ]
    return [
        f"### Yield rule blocks (S = {POLICY_YIELD_BLOCK_S:g} dB)",
        "",
        intro,
        "",
        "| stamp | block | kept or dropped | loud-frame step (dB) | ratio (dB) | verdict |",
        "| --- | ---: | --- | ---: | ---: | --- |",
        *rows,
        "",
    ]
