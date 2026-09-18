"""Reading derived bursts, and the small statistics every table is formatted from."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
from jbconfig import DER


def load_burst(stamp: str) -> tuple[dict[str, Any], np.ndarray]:
    """Return one burst's header metadata and its per-frame per-bin dB array."""
    meta: dict[str, Any] = json.loads((DER / f"{stamp}.json").read_text(encoding="utf-8"))
    db = np.load(DER / f"{stamp}.npy").astype(np.float32)
    return meta, db


def summed_db(db: np.ndarray) -> np.ndarray:
    """Per-frame per-bin dB of the power summed over channels."""
    return np.asarray(10.0 * np.log10(np.maximum(np.power(10.0, db / 10.0).sum(axis=1), 1e-20)))


def track_key(meta: dict[str, Any]) -> str:
    """Return the key that identifies the track a burst was taken from, rate included."""
    s = meta.get("status", {})
    # begin_min/begin_sec follow the burst's own position inside the track, so they identify the burst, not the track.
    return (
        "|".join(str(s.get(k, "?")) for k in ("transport_serial", "track_serial", "track"))
        + f"|{meta.get('samplerate')}"
    )


def stats(values: list[float]) -> dict[str, float]:
    """Return the count and the percentile spread of one side's values, or a bare count when there are none."""
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return {"n": 0}
    return {
        "n": int(arr.size),
        "min": float(arr.min()),
        "p10": float(np.percentile(arr, 10)),
        "p25": float(np.percentile(arr, 25)),
        "median": float(np.median(arr)),
        "p75": float(np.percentile(arr, 75)),
        "p90": float(np.percentile(arr, 90)),
        "max": float(arr.max()),
    }


def fmt_stats(values: dict[str, float]) -> str:
    """Return one markdown table row of a ``stats`` mapping, empty cells when it counts nothing."""
    if not values.get("n"):
        return "| 0 | | | | | | | |"
    return "| {n} | {min:.2f} | {p10:.2f} | {p25:.2f} | {median:.2f} | {p75:.2f} | {p90:.2f} | {max:.2f} |".format(
        **values
    )


def blocks(arrived: list[float], window: float) -> list[list[int]]:
    """Frame indices grouped into consecutive blocks of ``window`` seconds by arrival time."""
    t0 = arrived[0]
    out: dict[int, list[int]] = {}
    for i, t in enumerate(arrived):
        out.setdefault(int((t - t0) // window), []).append(i)
    return [out[k] for k in sorted(out)]


def musical_groups(arrived: list[float], musical: np.ndarray, window: float) -> list[list[int]]:
    """Blocks of ``window`` seconds reduced to their musical frames, dropping any block that is mostly silence."""
    return [
        [i for i in g if musical[i]]
        for g in blocks(arrived, window)
        if sum(1 for i in g if musical[i]) * 2 >= len(g) and any(musical[i] for i in g)
    ]
