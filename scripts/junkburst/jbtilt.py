"""Candidates T and U: the p90 curve's tilt across the selected fold, the container's top band, and their section."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbcandidates import fold_step
from jbconfig import (
    CANDIDATE_E_REF_HZ,
    CANDIDATE_T_BAND_HZ,
    CANDIDATE_T_GUARD_HZ,
    CANDIDATE_U_BASS_HZ,
    CANDIDATE_U_TOP_BAND_HZ,
    CANDIDATE_U_TOP_GUARD_HZ,
    EDGE_FOLDS_HZ,
    HEADLINE_WINDOW,
)
from jbcurves import band_bins
from jbedge import edge_cell, p90_curve
from jbflip import QUALIFIER_CUT, QUALIFIER_YIELD, flip_loao_row, flip_qualifier_rows, flip_sweep, flip_sweep_section
from jbmask import MASK_SWEEP_ALBUM_LEVEL
from jbmirror import MIRROR_VETO_LEVEL, veto_loao_any
from jbpolicy import policy_bursts, policy_grade_context, policy_rule_row

if TYPE_CHECKING:
    from jbcurves import Grid
    from jbrun import LabelledRun, MaskRow

#: The five values this section reports per block, in the order every table below carries them.
TILT_READINGS = ("above", "below", "flip", "top", "corr")
#: Decimal places each reading's cells are written to: the three slopes in dB per kHz, U's level in dB, U's
#: correlation as a bare ratio.
TILT_DECIMALS = {"above": 2, "below": 2, "flip": 2, "top": 1, "corr": 3}
#: The lower loud-frame step a block may engage at when the sign test reads it fake, in dB.
TILT_QUALIFIER_FLOOR = 6.0
#: The qualifier rule's name, carried into the policy table.
TILT_QUALIFIER_RULE = (
    f"G90 at {QUALIFIER_CUT:g} dB or {TILT_QUALIFIER_FLOOR:g} dB with T fake "
    f"({MIRROR_VETO_LEVEL:g} dB veto yielding at {QUALIFIER_YIELD:g} dB)"
)
#: The burst stamps the block-level table names outright.
TILT_BLOCK_STAMPS = (
    "20260918T045630Z",
    "20260918T050041Z",
    "20260917T133404Z",
    "20260917T133409Z",
    "20260918T231047Z",
    "20260918T081102Z",
    "20260917T121624Z",
)
#: Row-key fragments the block-level table finds one kept burst each under, beyond the stamps it names.
TILT_BLOCK_KEYS = ("Let Down", "Is It Now?", "Thrice Woven")
#: Frames a block needs before U's correlation carries a reading at all.
MIN_CORR_FRAMES = 2

#: ``TiltRows[reading]`` is one (stamp, value, label) per steady block at the headline window.
TiltRows = dict[str, list[tuple[str, float, str]]]


def band_slope(curve: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> float:
    """Return the least-squares slope of the curve over one band in dB per kHz, NaN when the band is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return float("nan")
    lo, hi = span
    if hi - lo < 1:
        return float("nan")
    khz = np.arange(lo, hi + 1, dtype=np.float64) * (grid.hz_per_bin / 1000.0)
    return float(np.polyfit(khz, np.asarray(curve[lo : hi + 1], dtype=np.float64), 1)[0])


def selected_fold(curve: np.ndarray, grid: Grid) -> float:
    """Return the fold the loud-frame step reads: whichever of ``EDGE_FOLDS_HZ`` carries the larger absolute step.

    NaN when neither fold carries both of its step bands inside the burst's grid, which is where G90 is NaN too.
    """
    steps = [(abs(s), hz) for hz, s in ((hz, fold_step(curve, grid, hz)) for hz in EDGE_FOLDS_HZ) if np.isfinite(s)]
    return max(steps)[1] if steps else float("nan")


def tilt_slopes(frames: np.ndarray, grid: Grid) -> dict[str, float]:
    """Candidate T for one block: the slope above the fold, the slope below it, and their difference."""
    curve = p90_curve(frames, grid)
    fold = selected_fold(curve, grid)
    if not np.isfinite(fold):
        return {"above": float("nan"), "below": float("nan"), "flip": float("nan")}
    above = band_slope(curve, grid, fold + CANDIDATE_T_GUARD_HZ, fold + CANDIDATE_T_GUARD_HZ + CANDIDATE_T_BAND_HZ)
    below = band_slope(curve, grid, fold - CANDIDATE_T_GUARD_HZ - CANDIDATE_T_BAND_HZ, fold - CANDIDATE_T_GUARD_HZ)
    return {"above": above, "below": below, "flip": above - below}


def _full_span(grid: Grid, lo_hz: float, hi_hz: float) -> tuple[int, int] | None:
    """Return a band's bin span over the burst's full bin range, ``None`` when it reaches past the top bin.

    ``band_bins`` stops at the bins the working grid keeps; U's top band sits above them by construction.
    """
    top = grid.bins - 1
    if hi_hz > grid.hz(top):
        return None
    lo, hi = max(0, round(lo_hz / grid.hz_per_bin)), min(top, round(hi_hz / grid.hz_per_bin))
    return (lo, hi) if hi > lo else None


def full_band_level_db(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: the dB level of the linear power summed over one band of the burst's full bin range."""
    span = _full_span(grid, lo_hz, hi_hz)
    if span is None:
        return None
    lo, hi = span
    return np.asarray(10.0 * np.log10(np.maximum(np.power(10.0, frames[:, lo : hi + 1] / 10.0).sum(axis=1), 1e-20)))


def _pearson(first: np.ndarray, second: np.ndarray) -> float:
    """Return the Pearson correlation of two per-frame series, NaN where either does not move across the block."""
    if first.size < MIN_CORR_FRAMES or float(first.std()) <= 0.0 or float(second.std()) <= 0.0:
        return float("nan")
    return float(np.corrcoef(first, second)[0, 1])


def top_band_values(frames: np.ndarray, grid: Grid) -> dict[str, float]:
    """Candidate U for one block: the top band's level against the music band, and its correlation with the bass."""
    nyquist = grid.bandwidth
    top = full_band_level_db(
        frames, grid, nyquist - CANDIDATE_U_TOP_GUARD_HZ - CANDIDATE_U_TOP_BAND_HZ, nyquist - CANDIDATE_U_TOP_GUARD_HZ
    )
    ref = full_band_level_db(frames, grid, *CANDIDATE_E_REF_HZ)
    bass = full_band_level_db(frames, grid, *CANDIDATE_U_BASS_HZ)
    if top is None or ref is None or bass is None:
        return {"top": float("nan"), "corr": float("nan")}
    return {"top": float(np.percentile(top, 90) - np.percentile(ref, 90)), "corr": _pearson(top, bass)}


def block_tilt_values(frames: np.ndarray, grid: Grid) -> dict[str, float]:
    """Return one block's five readings, T's three then U's two, keyed by reading."""
    return {**tilt_slopes(frames, grid), **top_band_values(frames, grid)}


def tilt_fake(above: float, below: float) -> bool:
    """Report the sign test: fake where the slope above the fold sits at or over 0 and the one below sits under 0."""
    return bool(np.isfinite(above) and np.isfinite(below) and above >= 0.0 and below < 0.0)


def tilt_cell(reading: str, value: float) -> str:
    """One table cell: the reading's own decimals, or ``none`` where the block carries no reading."""
    return "none" if not np.isfinite(value) else f"{value:.{TILT_DECIMALS[reading]}f}"


def _pair(rows: TiltRows, index: int) -> tuple[float, float]:
    """Return one block's above and below slopes."""
    return rows["above"][index][1], rows["below"][index][1]


def qualifier_call(g90: float, ratio: float, above: float, below: float) -> bool:
    """One block's qualifier verdict: the loud-frame step clears its cut, and the ratio veto stands down or yields."""
    if not np.isfinite(g90):
        return False
    clears = g90 >= QUALIFIER_CUT or (g90 >= TILT_QUALIFIER_FLOOR and tilt_fake(above, below))
    if not clears:
        return False
    return not (np.isfinite(ratio) and ratio >= MIRROR_VETO_LEVEL) or g90 >= QUALIFIER_YIELD


def tilt_albums(rows: TiltRows, row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key over the kept blocks: its label, how many it keeps, and the median of all five readings."""
    out: dict[str, dict[str, Any]] = {}
    for index, (stamp, _value, label) in enumerate(rows[TILT_READINGS[0]]):
        entry = out.setdefault(row_key_of[stamp], {"label": label, "kept": 0, "values": {r: [] for r in TILT_READINGS}})
        entry["kept"] += 1
        for reading in TILT_READINGS:
            value = rows[reading][index][1]
            if np.isfinite(value):
                entry["values"][reading].append(float(value))
    for entry in out.values():
        entry["median"] = {
            reading: (float(np.median(values)) if values else float("nan"))
            for reading, values in entry["values"].items()
        }
    return out


def _sign_rows(rows: TiltRows) -> list[tuple[str, float, str]]:
    """Return the sign test as a candidate: 1 where the block reads fake, 0 where it does not."""
    return [
        (stamp, 1.0 if tilt_fake(*_pair(rows, index)) else 0.0, label)
        for index, (stamp, _value, label) in enumerate(rows[TILT_READINGS[0]])
    ]


def qualifier_block_grade(
    mask_rows: list[MaskRow], g90_rows: list[tuple[str, float, str]], rows: TiltRows
) -> dict[str, Any]:
    """Return the qualifier rule's block-level wrong-side counts over the kept blocks; every cut in it is fixed."""
    total: dict[str, Any] = {"wrong": 0, "fake_called_real": 0, "real_called_fake": 0, "blocks": len(mask_rows)}
    for index, (_stamp, value, label) in enumerate(g90_rows):
        is_fake = label == "FAKE"
        if qualifier_call(value, mask_rows[index][3], *_pair(rows, index)) == is_fake:
            continue
        total["wrong"] += 1
        total["fake_called_real" if is_fake else "real_called_fake"] += 1
    return total


def _keyed_stamp(mask_rows: list[MaskRow], keep: list[int], row_key_of: dict[str, str], needle: str) -> str:
    """Return the stamp of the first kept block whose row key names ``needle``."""
    for index in keep:
        stamp = mask_rows[index][0]
        if needle in row_key_of[stamp]:
            return stamp
    raise ValueError(f"no kept block under a row key naming {needle}")


def tilt_block_rows(
    mask_rows: list[MaskRow],
    g90_rows: list[tuple[str, float, str]],
    rows: TiltRows,
    keep: list[int],
    row_key_of: dict[str, str],
) -> list[dict[str, Any]]:
    """One row per 1 s block of the named bursts and of one kept burst under each of ``TILT_BLOCK_KEYS``."""
    stamps = (*TILT_BLOCK_STAMPS, *(_keyed_stamp(mask_rows, keep, row_key_of, key) for key in TILT_BLOCK_KEYS))
    kept = set(keep)
    bursts = policy_bursts(mask_rows)
    out = []
    for stamp in stamps:
        for n, index in enumerate(bursts.get(stamp, [])):
            above, below = _pair(rows, index)
            g90, ratio = g90_rows[index][1], mask_rows[index][3]
            out.append(
                {
                    "stamp": stamp,
                    "index": n,
                    "kept": index in kept,
                    "g90": float(g90),
                    "ratio": float(ratio),
                    **{reading: float(rows[reading][index][1]) for reading in TILT_READINGS},
                    "verdict": bool(index in kept and qualifier_call(g90, ratio, above, below)),
                }
            )
    return out


def _grades(
    kept_mask: list[MaskRow], kept_g90: list[tuple[str, float, str]], kept_rows: TiltRows, album_of: dict[str, str]
) -> list[dict[str, Any]]:
    """Return the section's graded rules: T's sign test, U's two readings, then the qualifier."""
    held_out = (
        ("T sign test alone", _sign_rows(kept_rows)),
        ("U top band", kept_rows["top"]),
        ("U bass correlation", kept_rows["corr"]),
    )
    return [
        *({"rule": name, **veto_loao_any(kept_mask, [rows], album_of, MIRROR_VETO_LEVEL)} for name, rows in held_out),
        {"rule": TILT_QUALIFIER_RULE, **qualifier_block_grade(kept_mask, kept_g90, kept_rows)},
    ]


def tilt_augment(run: LabelledRun) -> None:
    """Read T and U over the kept blocks, grade them, and add the qualifier rule to the policy table."""
    _blocks, bursts, kept, mask_rows, g90_rows, keep = policy_grade_context(run)
    rows: TiltRows = run.tilt["steady"]
    junk = {i: qualifier_call(g90_rows[i][1], mask_rows[i][3], *_pair(rows, i)) for i in keep}
    run.policy_grade["rules"].append(policy_rule_row(TILT_QUALIFIER_RULE, junk, bursts, kept, run))
    flip_blocks = list(zip(mask_rows, g90_rows, rows["flip"], strict=True))
    run.policy_grade["rules"] += flip_qualifier_rows(flip_blocks, bursts, kept, run)
    kept_rows: TiltRows = {reading: [rows[reading][i] for i in keep] for reading in TILT_READINGS}
    run.tilt_albums = tilt_albums(kept_rows, run.row_key_of)
    run.tilt_grades = _grades([mask_rows[i] for i in keep], [g90_rows[i] for i in keep], kept_rows, run.album_of)
    run.tilt_blocks = tilt_block_rows(mask_rows, g90_rows, rows, keep, run.row_key_of)
    kept_mask, kept_g90, kept_flip = [mask_rows[i] for i in keep], [g90_rows[i] for i in keep], kept_rows["flip"]
    run.tilt_flip_sweep = flip_sweep(kept_mask, kept_g90, kept_flip, run.row_key_of)
    run.tilt_flip_loao = flip_loao_row(kept_mask, kept_g90, kept_flip, run.album_of, run.row_key_of)


def _tilt_intro() -> str:
    """State what the five readings are, where they are taken and which blocks the section is read over."""
    folds = " and ".join(f"{hz / 1000:g} kHz" for hz in EDGE_FOLDS_HZ)
    return (
        f"Over the blocks the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s. T reads each "
        f"block's per-bin 90th percentile curve, smoothed by the 9-bin median, at whichever of {folds} the "
        f"loud-frame step reads — the fold carrying the larger absolute step. `above` is the least-squares slope of "
        f"that curve in dB per kHz over the {CANDIDATE_T_BAND_HZ / 1000:g} kHz band starting "
        f"{CANDIDATE_T_GUARD_HZ:g} Hz above the fold, `below` is the same over the "
        f"{CANDIDATE_T_BAND_HZ / 1000:g} kHz band ending {CANDIDATE_T_GUARD_HZ:g} Hz below it, and `flip` is "
        f"`above` minus `below`. The sign test reads a block fake when `above` sits at or over 0 and `below` under "
        f"0. U reads the top of the container instead: `top` is the 90th percentile across the block's frames of "
        f"the summed level over the {CANDIDATE_U_TOP_BAND_HZ / 1000:g} kHz band ending "
        f"{CANDIDATE_U_TOP_GUARD_HZ:g} Hz below the burst's own Nyquist, minus the same over "
        f"{CANDIDATE_E_REF_HZ[0] / 1000:g} to {CANDIDATE_E_REF_HZ[1] / 1000:g} kHz, and `corr` is the Pearson "
        f"correlation across the block's frames between that top band's summed level and the summed level over "
        f"{CANDIDATE_U_BASS_HZ[0]:g} to {CANDIDATE_U_BASS_HZ[1]:g} Hz. The top band lies above the bins the working "
        f"grid keeps, so U alone is read over the burst's full bin range."
    )


def _tilt_album_rows(run: LabelledRun) -> list[str]:
    """One row per album: its label, its kept blocks, and the median of all five readings."""
    out = []
    for name, entry in sorted(run.tilt_albums.items()):
        medians = " | ".join(tilt_cell(reading, entry["median"][reading]) for reading in TILT_READINGS)
        out.append(f"| {name} | {entry['label']} | {entry['kept']} | {medians} |")
    return out


def _tilt_grade_intro() -> str:
    """State how each of the graded rules is read."""
    return (
        f"The first three rules are graded over the kept blocks with each album held out in turn and each cut "
        f"picked over the other albums' kept blocks for the fewest wrong-side blocks, the "
        f"{MIRROR_VETO_LEVEL:g} dB ratio veto forcing a block real whatever the cut says. The qualifier reads fake "
        f"when the loud-frame step sits at or over {QUALIFIER_CUT:g} dB, or at or over "
        f"{TILT_QUALIFIER_FLOOR:g} dB with the sign test reading fake, the {MIRROR_VETO_LEVEL:g} dB ratio veto "
        f"forcing it real unless the step sits at or over {QUALIFIER_YIELD:g} dB; every cut in the qualifier "
        f"is fixed, so nothing in it is fitted and nothing is held out."
    )


def _tilt_block_table(run: LabelledRun) -> list[str]:
    """Return the block-level table for the named bursts and the three the row keys find."""
    intro = (
        f"Every 1 s block of the bursts this table names, whether the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps or "
        f"drops it. The last three bursts are the first kept burst under a row key naming "
        f"{', '.join(TILT_BLOCK_KEYS)}. Verdict reads engage where the qualifier rule fires; a dropped block never "
        f"engages."
    )
    cells = ("above", "below", "top", "corr")
    rows = [
        f"| {b['stamp']} | {b['index']} | {'kept' if b['kept'] else 'dropped'} | {edge_cell('G90', b['g90'])} | "
        f"{b['ratio']:.1f} | " + " | ".join(tilt_cell(c, b[c]) for c in cells) + " | "
        f"{'engage' if b['verdict'] else 'no'} |"
        for b in run.tilt_blocks
    ]
    return [
        "### Qualifier rule blocks",
        "",
        intro,
        "",
        (
            "| stamp | block | kept or dropped | loud-frame step (dB) | ratio (dB) | above | below | top (dB) | "
            "corr | verdict |"
        ),
        "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        *rows,
        "",
    ]


def tilt_section(run: LabelledRun) -> list[str]:
    """Return the report's tilt section: the per-album medians, the grades, then the block table."""
    grade_rows = [
        f"| {row['rule']} | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.tilt_grades
    ]
    return [
        "## Tilt",
        "",
        _tilt_intro(),
        "",
        f"### Per-album kept blocks at {MASK_SWEEP_ALBUM_LEVEL:g} dB",
        "",
        "| album | label | kept | " + " | ".join(f"median {reading}" for reading in TILT_READINGS) + " |",
        "| --- | --- | ---: | " + " | ".join("---:" for _ in TILT_READINGS) + " |",
        *_tilt_album_rows(run),
        "",
        "### Grades",
        "",
        _tilt_grade_intro(),
        "",
        "| rule | wrong | fake called real | real called fake |",
        "| --- | ---: | ---: | ---: |",
        *grade_rows,
        "",
        *flip_sweep_section(run),
        *_tilt_block_table(run),
    ]
