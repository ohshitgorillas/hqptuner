"""Candidate T's `flip` reading as a rule of its own: its fixed-cut sweep, its held-out cut and its qualifier rows."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbloao import loao_calls
from jbmirror import MIRROR_VETO_LEVEL
from jbpolicy import POLICY_G90_FIXED_CUT, policy_rule_row, veto_forces_real, wrong_side_row

if TYPE_CHECKING:
    from jbrun import LabeledRun, MaskRow

#: The loud-frame step a block must clear on its own to engage under a qualifier rule, in dB.
QUALIFIER_CUT = POLICY_G90_FIXED_CUT
#: The loud-frame step at which the ratio veto yields under a qualifier rule, in dB.
QUALIFIER_YIELD = 14.0
#: The fixed `flip` cuts the flip sweep and the flip qualifier rows read, in dB per kHz.
FLIP_CUTS = (1.5, 2.0, 2.5, 3.0, 4.0)
#: The loud-frame step floors the flip qualifier rows are read at, in dB, beyond the fixed cut both share with
#: ``QUALIFIER_CUT``.
FLIP_QUALIFIER_FLOORS = (6.0, 8.0)


def flip_sweep_call(mask_row: MaskRow, g90_value: float, flip_value: float, cut: float) -> bool:
    """One block's verdict under the flip sweep: flip clears the cut, the ratio veto standing down or yielding."""
    if not (np.isfinite(flip_value) and flip_value >= cut):
        return False
    if not veto_forces_real(mask_row, MIRROR_VETO_LEVEL):
        return True
    return bool(np.isfinite(g90_value) and g90_value >= QUALIFIER_YIELD)


def flip_cut_row(
    mask_rows: list[MaskRow],
    g90_rows: list[tuple[str, float, str]],
    flip_rows: list[tuple[str, float, str]],
    row_key_of: dict[str, str],
    cut: float,
) -> dict[str, Any]:
    """One flip cut over the kept blocks: its wrong-side counts, and the wrong count per album or track row key."""
    graded = (
        (stamp, label == "FAKE", flip_sweep_call(mask_row, g90_value, flip_value, cut))
        for mask_row, (stamp, g90_value, label), (_, flip_value, _) in zip(mask_rows, g90_rows, flip_rows, strict=True)
    )
    return wrong_side_row(graded, row_key_of, {"cut": float(cut)})


def flip_sweep(
    mask_rows: list[MaskRow],
    g90_rows: list[tuple[str, float, str]],
    flip_rows: list[tuple[str, float, str]],
    row_key_of: dict[str, str],
) -> list[dict[str, Any]]:
    """One row per ``FLIP_CUTS`` value, over the kept blocks the caller passes in."""
    return [flip_cut_row(mask_rows, g90_rows, flip_rows, row_key_of, cut) for cut in FLIP_CUTS]


def flip_loao_row(
    mask_rows: list[MaskRow],
    g90_rows: list[tuple[str, float, str]],
    flip_rows: list[tuple[str, float, str]],
    album_of: dict[str, str],
    row_key_of: dict[str, str],
) -> dict[str, Any]:
    """Flip's leave-one-album-out cut over the same kept blocks ``flip_sweep`` reads, wrong-side counts."""
    calls = loao_calls(flip_rows, album_of, range(len(flip_rows)))
    graded = (
        (
            stamp,
            label == "FAKE",
            calls.get(i, False)
            and (
                not veto_forces_real(mask_rows[i], MIRROR_VETO_LEVEL)
                or bool(np.isfinite(g90_rows[i][1]) and g90_rows[i][1] >= QUALIFIER_YIELD)
            ),
        )
        for i, (stamp, _value, label) in enumerate(flip_rows)
    )
    return wrong_side_row(graded, row_key_of)


def flip_qualifier_call(g90: float, ratio: float, flip: float, floor: float, cut: float) -> bool:
    """One block's verdict: G90 clears its fixed cut, or clears ``floor`` with flip over ``cut``; veto as above."""
    if not np.isfinite(g90):
        return False
    clears = g90 >= QUALIFIER_CUT or (g90 >= floor and np.isfinite(flip) and flip >= cut)
    if not clears:
        return False
    return not (np.isfinite(ratio) and ratio >= MIRROR_VETO_LEVEL) or g90 >= QUALIFIER_YIELD


def flip_qualifier_rule_name(floor: float, cut: float) -> str:
    """Name one flip qualifier row for the policy table."""
    return (
        f"loud-frame step at or over {QUALIFIER_CUT:g} dB, or at or over {floor:g} dB with flip at or over "
        f"{cut:g} dB per kHz ({MIRROR_VETO_LEVEL:g} dB veto yielding at {QUALIFIER_YIELD:g} dB)"
    )


def flip_qualifier_rows(
    blocks: list[tuple[MaskRow, tuple[str, float, str], tuple[str, float, str]]],
    bursts: dict[str, list[int]],
    kept: set[int],
    run: LabeledRun,
) -> list[dict[str, Any]]:
    """Ten policy rows: the flip qualifier rule at each of ``FLIP_QUALIFIER_FLOORS`` times ``FLIP_CUTS``.

    ``blocks[i]`` is the mask row, the G90 row and the flip row of block ``i``, in ``run.tilt``'s own order.
    """
    out = []
    for floor in FLIP_QUALIFIER_FLOORS:
        for cut in FLIP_CUTS:
            junk = {i: flip_qualifier_call(blocks[i][1][1], blocks[i][0][3], blocks[i][2][1], floor, cut) for i in kept}
            out.append(policy_rule_row(flip_qualifier_rule_name(floor, cut), junk, bursts, kept, run))
    return out


def _flip_sweep_intro() -> str:
    """State how the flip sweep's rows and its per-cut tables are read."""
    return (
        f"Over the same kept blocks, `flip` alone against each fixed cut in dB per kHz — no per-album fitting — "
        f"with the {MIRROR_VETO_LEVEL:g} dB ratio veto forcing a block real unless the block's own loud-frame step "
        f"sits at or above {QUALIFIER_YIELD:g} dB, yielding the veto. The per-row table under each cut lists "
        f"every album or track row key carrying at least one wrong block there, and how many."
    )


def flip_sweep_section(run: LabeledRun) -> list[str]:
    """Return the flip sweep: one row per ``FLIP_CUTS`` cut plus the leave-one-album-out row, then per-cut tables."""
    head = "| cut (dB per kHz) | wrong | fake called real | real called fake |"
    rows = [
        f"| {row['cut']:g} | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.tilt_flip_sweep
    ]
    loao = run.tilt_flip_loao
    rows.append(f"| leave-one-album-out | {loao['wrong']} | {loao['fake_called_real']} | {loao['real_called_fake']} |")
    out = ["### Flip sweep", "", _flip_sweep_intro(), "", head, "| --- | ---: | ---: | ---: |", *rows, ""]
    for row in run.tilt_flip_sweep:
        out += [f"#### {row['cut']:g} dB per kHz", "", "| album or track | wrong |", "| --- | ---: |"]
        out += [f"| {name} | {count} |" for name, count in sorted(row["rows"].items())]
        out.append("")
    return out
