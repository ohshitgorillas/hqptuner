"""The G90-at-11-dB veto-yield rule family: a loud-frame step high enough forces the ratio veto to stand down."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbedge import edge_cell
from jbmask import MASK_SWEEP_ALBUM_LEVEL
from jbmirror import MIRROR_VETO_LEVEL
from jbpolicy import (
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


def policy_yield_augment(run: LabelledRun) -> None:
    """Grow ``run.policy_grade`` with the yield rule rows and their block-level table rows."""
    blocks, bursts, kept, mask_rows, g90_rows, keep = policy_grade_context(run)
    run.policy_grade["rules"] += policy_yield_grade(blocks, bursts, kept, run)
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
