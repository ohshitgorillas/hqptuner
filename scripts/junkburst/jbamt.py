"""Candidate AMT's veto-factor sweep: AM re-called at every factor, its threshold re-picked at each."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from jbcandidates import amt_call
from jbconfig import AMT_FACTOR_SWEEP, GROUPS, HEADLINE_WINDOW
from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from jbrun import AmtCache, Scored


def _factor_row(
    am_thr: dict[str, Any], entries: list[tuple[str, float, str, float, float]], factor: float
) -> dict[str, Any]:
    """One factor's row: AMT's call per block at that factor, and the threshold picked over those calls."""
    calls: list[float] = []
    labels: list[str] = []
    for _stamp, am_val, label, near_med, ref_med in entries:
        calls.append(1.0 if amt_call(near_med, ref_med, factor, am_fake=calls_fake(am_val, am_thr)) else 0.0)
        labels.append(label)
    return {"factor": float(factor), "values": calls, "labels": labels, **best_threshold(calls, labels)}


def amt_sweep(scored: Scored, amt_cache: AmtCache) -> dict[str, dict[str, Any]]:
    """AM vetoed by the near-edge-versus-reference spread ratio, the factor swept and the threshold re-picked at each.

    The sweep runs at the headline window, the same shape as the E2 and E3 guard sweep.
    """
    amt_best: dict[str, dict[str, Any]] = {}
    for group in GROUPS:
        am_thr = scored[group][HEADLINE_WINDOW]["AM"]
        rows = [_factor_row(am_thr, amt_cache[group], factor) for factor in AMT_FACTOR_SWEEP]
        amt_best[group] = min(rows, key=lambda r: (r["wrong"], r["factor"]))
        row = amt_best[group]
        print(
            f"amt group={group} best_factor={row['factor']:g} wrong={row['wrong']}/{row['blocks']} "
            f"fake_called_real={row['fake_called_real']} real_called_fake={row['real_called_fake']}"
        )
    return amt_best
