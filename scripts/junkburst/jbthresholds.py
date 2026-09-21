"""Threshold picking for the owner-labelled run, and the candidate register the tables are titled from."""

from __future__ import annotations

from typing import Any

import numpy as np
from jbcandidates import e2_value, e3_value
from jbconfig import (
    CANDIDATE_C_HZ,
    CANDIDATE_D_HZ,
    CANDIDATE_E2_MIN_REF_SPREAD_DB,
    CANDIDATE_E3_MIN_REF_OVER_FLOOR_DB,
    CANDIDATE_E_NUM_HZ,
    CANDIDATE_E_REF_HZ,
    CANDIDATE_F_FOLDS_HZ,
    CANDIDATE_F_INNER_HZ,
    CANDIDATE_F_OUTER_HZ,
    CANDIDATE_G_BAND_HZ,
    CANDIDATE_G_CONTROL_FOLDS_HZ,
    CANDIDATE_G_FOLDS_HZ,
    CANDIDATE_G_GUARD_HZ,
    CANDIDATE_H_OFFSET_HZ,
    FLOOR_PCT,
    SMOOTH_BINS,
)

#: The separator between a band's two edges in every candidate title below.
EN_DASH = chr(0x2013)

#: One row per block: the owner's label, E2's two parts, then E3's three.
PartRow = tuple[str, float, float, float, float, float]

#: Captured per block during the scoring loop; AF is derived afterward from A's and F's own thresholds, so it is not
#: in this tuple.
BASE_LABEL_CANDIDATES = ("A", "AW", "AM", "B", "C", "advisor", "D", "E2", "E3", "F", "G", "GC", "H")
#: Full candidate order for reporting, once AF has been computed.
LABEL_CANDIDATES = (*BASE_LABEL_CANDIDATES, "AF")
LABEL_CAND_TITLE = {
    "A": "A — per-bin 90th percentile, cliff fall (dB)",
    "AW": "AW — walk-up A: per-bin 90th percentile, cliff fall (dB) read from the walk-up edge",
    "AM": "AM — the larger of A's fall and AW's fall, NaN only when both carry no reading",
    "B": "B — per-bin mean of linear power, cliff fall (dB)",
    "C": f"C — share of the block's frames with content above {CANDIDATE_C_HZ / 1000:g} kHz",
    "advisor": "junkrun.read_block on the block's own record (1 when the block reads junk)",
    "D": f"D — share of the block's musical frames with content above {CANDIDATE_D_HZ / 1000:g} kHz",
    "E2": (
        f"E2 — per-frame band level, linear power summed over "
        f"{CANDIDATE_E_NUM_HZ[0] / 1000:g}{EN_DASH}{CANDIDATE_E_NUM_HZ[1] / 1000:g} kHz and over "
        f"{CANDIDATE_E_REF_HZ[0] / 1000:g}{EN_DASH}{CANDIDATE_E_REF_HZ[1] / 1000:g} kHz; p90 minus p10 in dB of each "
        f"band "
        f"level across the block, upper spread divided by lower, no reading when the lower spread is under "
        f"{CANDIDATE_E2_MIN_REF_SPREAD_DB:g} dB"
    ),
    "E3": (
        f"E3 — the block's per-bin median in dB minus a {SMOOTH_BINS}-bin median smooth of itself; mean absolute "
        f"residual over {CANDIDATE_E_NUM_HZ[0] / 1000:g}{EN_DASH}{CANDIDATE_E_NUM_HZ[1] / 1000:g} kHz divided by the "
        f"same over {CANDIDATE_E_REF_HZ[0] / 1000:g}{EN_DASH}{CANDIDATE_E_REF_HZ[1] / 1000:g} kHz, no reading when "
        f"the "
        f"reference band's median sits under {CANDIDATE_E3_MIN_REF_OVER_FLOOR_DB:g} dB above the "
        f"{FLOOR_PCT}th-percentile floor"
    ),
    "F": (
        f"F — Pearson correlation between the block's residual (per-bin median in dB minus a {SMOOTH_BINS}-bin "
        f"median smooth of itself) over {CANDIDATE_F_INNER_HZ:g}-{CANDIDATE_F_OUTER_HZ:g} Hz below each fold and the "
        f"same mirrored above it, for folds at "
        + " and ".join(f"{hz / 1000:g} kHz" for hz in CANDIDATE_F_FOLDS_HZ)
        + ", F the larger of the two"
    ),
    "G": (
        f"G — the block's per-bin minimum in dB after a {SMOOTH_BINS}-bin median smooth; at each fold the median over "
        f"the {CANDIDATE_G_BAND_HZ / 1000:g} kHz band starting {CANDIDATE_G_GUARD_HZ:g} Hz above it minus the median "
        f"over the {CANDIDATE_G_BAND_HZ / 1000:g} kHz band ending {CANDIDATE_G_GUARD_HZ:g} Hz below it, G the largest "
        f"absolute value over the folds at " + " and ".join(f"{hz / 1000:g} kHz" for hz in CANDIDATE_G_FOLDS_HZ)
    ),
    "GC": (
        "GC — G minus the median of the same absolute step measured at control folds "
        + ", ".join(f"{hz / 1000:g} kHz" for hz in CANDIDATE_G_CONTROL_FOLDS_HZ)
        + "; a fold or control outside the burst's grid drops out, and GC carries no reading when every control does"
    ),
    "H": (
        f"H — G's signed step at a fold, minus the mean of the same two-band difference centred "
        f"{CANDIDATE_H_OFFSET_HZ / 1000:g} kHz below the fold and {CANDIDATE_H_OFFSET_HZ / 1000:g} kHz above it; H "
        f"the larger absolute value over the folds at "
        + " and ".join(f"{hz / 1000:g} kHz" for hz in CANDIDATE_G_FOLDS_HZ)
        + ", a fold whose own step or both offset steps fall outside the burst's grid carrying no reading"
    ),
    "AF": "AF — fake when A reads fake at A's own threshold or F reads fake at F's own threshold",
}


def _no_reading_result(n_fake: int, n_real: int) -> dict[str, Any]:
    """Return the result for a candidate no block carries a reading for: every fake block is called real."""
    return {
        "threshold": float("nan"),
        "fake_high": True,
        "wrong": n_fake,
        "fake_called_real": n_fake,
        "real_called_fake": 0,
        "blocks": n_fake + n_real,
        "fake_blocks": n_fake,
        "real_blocks": n_real,
    }


def best_threshold(values: list[float], labels: list[str]) -> dict[str, Any]:
    """Return the threshold over this candidate's own values that puts the fewest blocks on the wrong side.

    A block with no reading cannot read FAKE, exactly as a block with no cliff reading cannot read cliff. Both
    directions are swept, so a candidate that runs high on fakes and one that runs low are scored the same way; ties on
    wrong-side count are broken at the middle of the run of thresholds that tie.
    """
    v = np.asarray(values, dtype=np.float64)
    is_fake = np.asarray([lab == "FAKE" for lab in labels], dtype=bool)
    finite = np.isfinite(v)
    n_fake, n_real = int(is_fake.sum()), int((~is_fake).sum())
    cand = np.unique(v[finite])
    if cand.size == 0:
        return _no_reading_result(n_fake, n_real)
    ts = np.concatenate(([cand[0] - 1.0], (cand[:-1] + cand[1:]) / 2.0, [cand[-1] + 1.0]))
    fv = np.sort(v[finite & is_fake])
    rv = np.sort(v[finite & ~is_fake])
    fake_nan = n_fake - fv.size
    best: dict[str, Any] | None = None
    for fake_high in (True, False):
        below_f = np.searchsorted(fv, ts, side="left")
        below_r = np.searchsorted(rv, ts, side="left")
        if fake_high:
            fcr = fake_nan + below_f
            rcf = rv.size - below_r
        else:
            fcr = fake_nan + (fv.size - below_f)
            rcf = below_r
        wrong = fcr + rcf
        low = int(wrong.min())
        tie = np.flatnonzero(wrong == low)
        i = int(tie[tie.size // 2])
        if best is None or low < best["wrong"]:
            best = {
                "threshold": float(ts[i]),
                "fake_high": bool(fake_high),
                "wrong": low,
                "fake_called_real": int(fcr[i]),
                "real_called_fake": int(rcf[i]),
                "blocks": n_fake + n_real,
                "fake_blocks": n_fake,
                "real_blocks": n_real,
            }
    assert best is not None
    return best


def reads_fake(value: float, threshold: float, *, fake_high: bool) -> bool:
    """One block's verdict under a chosen threshold; a block with no reading reads REAL."""
    if not np.isfinite(value) or not np.isfinite(threshold):
        return False
    return (value >= threshold) == fake_high


def calls_fake(value: float, thr: dict[str, Any]) -> bool:
    """One block's verdict under a threshold result, read at that result's own side."""
    return reads_fake(value, thr["threshold"], fake_high=thr["fake_high"])


def sweep_guard(part_rows: list[PartRow], cand: str, guards: tuple[float, ...]) -> list[dict[str, Any]]:
    """One row per guard value: the candidate re-read at that guard, thresholded again over its own values.

    The guard only decides which blocks carry a reading, so the threshold is re-swept for every guard value rather
    than carried over from the guard the run was configured with.
    """
    out: list[dict[str, Any]] = []
    for guard in guards:
        values, labels = [], []
        for label, e2_upper, e2_lower, e3_num, e3_ref, e3_over in part_rows:
            values.append(
                e2_value(e2_upper, e2_lower, guard) if cand == "E2" else e3_value(e3_num, e3_ref, e3_over, guard)
            )
            labels.append(label)
        best = best_threshold(values, labels)
        out.append(
            {
                "guard": float(guard),
                "no_reading": int(sum(1 for v in values if not np.isfinite(v))),
                **best,
            }
        )
    return out


def best_guard(sweep_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Return the guard row with the fewest wrong-side blocks; ties go to the guard leaving the fewest blocks unread."""
    return min(sweep_rows, key=lambda r: (r["wrong"], r["no_reading"], r["guard"]))
