"""The real veto: the ratio reading's deciles and per-album medians, and G's grade retaken under each veto line."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbmask import DECILES, MASK_SWEEP_ALBUM_LEVEL, MASK_SWEEP_CANDIDATE, SWEEP_LABELS, sweep_keep
from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from jbrun import LabelledRun, MaskRow

#: Ratio lines the real veto forces to read real, at or above each line.
REAL_VETO_LEVELS = (-8.0, -10.0, -12.0, -15.0, -18.0)


def _veto_call(mask_row: MaskRow, value: float, thr: dict[str, Any], veto_level: float) -> bool:
    """One block's verdict under a threshold, forced real when its ratio sits at or above the veto line."""
    if np.isfinite(mask_row[3]) and mask_row[3] >= veto_level:
        return False
    return calls_fake(value, thr)


def veto_loao(
    mask_rows: list[MaskRow], block_rows: list[tuple[str, float, str]], album_of: dict[str, str], veto_level: float
) -> dict[str, Any]:
    """G's leave-one-album-out grade over every mask row, with the veto line forcing kept blocks real.

    The threshold is picked over the other albums' blocks unforced, as in ``jbloao.loao_candidate``; only the
    held-out block's own call is the veto-forced one.
    """
    by_album: dict[str, list[int]] = {}
    for i in range(len(mask_rows)):
        by_album.setdefault(album_of[block_rows[i][0]], []).append(i)
    total: dict[str, Any] = {
        "wrong": 0,
        "fake_called_real": 0,
        "real_called_fake": 0,
        "blocks": len(mask_rows),
        "albums": dict.fromkeys(by_album, 0),
    }
    for album, held in by_album.items():
        rest = [i for i in range(len(mask_rows)) if i not in set(held)]
        if not rest:
            continue
        thr = best_threshold([block_rows[i][1] for i in rest], [block_rows[i][2] for i in rest])
        for i in held:
            _, value, label = block_rows[i]
            is_fake = label == "FAKE"
            if _veto_call(mask_rows[i], value, thr, veto_level) == is_fake:
                continue
            total["wrong"] += 1
            total["albums"][album] += 1
            total["fake_called_real" if is_fake else "real_called_fake"] += 1
    return total


def real_veto_deciles(rows: list[MaskRow]) -> dict[str, dict[str, Any]]:
    """Return the ratio reading's deciles, split FAKE from REAL, over the blocks the album line keeps."""
    kept: dict[str, list[float]] = {label: [] for label in SWEEP_LABELS}
    for row in rows:
        if np.isfinite(row[3]):
            kept[row[1]].append(float(row[3]))
    return {
        label: {
            "blocks": len(values),
            "deciles": [float(np.percentile(values, p)) for p in DECILES] if values else [],
        }
        for label, values in kept.items()
    }


def real_veto_albums(rows: list[MaskRow], row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key over the blocks the album line keeps: its label, its kept blocks, and the median ratio."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = out.setdefault(row_key_of[row[0]], {"label": row[1], "kept": 0, "ratios": []})
        entry["kept"] += 1
        if np.isfinite(row[3]):
            entry["ratios"].append(float(row[3]))
    for entry in out.values():
        entry["median_ratio"] = float(np.median(entry["ratios"])) if entry["ratios"] else float("nan")
    return out


def real_veto(
    rows: list[MaskRow],
    block_rows: list[tuple[str, float, str]],
    album_of: dict[str, str],
    row_key_of: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Return the real veto's three parts: the ratio deciles, the per-album table, and the veto sweep.

    ``rows`` and ``block_rows`` are the full steady headline blocks; every part is read over the blocks the mask
    sweep's album line keeps out of them.
    """
    keep = sweep_keep(rows, MASK_SWEEP_ALBUM_LEVEL)
    kept_rows = [rows[i] for i in keep]
    kept_block_rows = [block_rows[i] for i in keep]
    deciles = real_veto_deciles(kept_rows)
    albums = real_veto_albums(kept_rows, row_key_of)
    sweep = [
        {"level": float(level), **veto_loao(kept_rows, kept_block_rows, album_of, level)} for level in REAL_VETO_LEVELS
    ]
    return deciles, albums, sweep


def real_veto_section(run: LabelledRun) -> list[str]:
    """Return the report's real veto section: the ratio deciles, the per-album table, then the veto sweep."""
    cand = MASK_SWEEP_CANDIDATE
    intro = (
        f"Over the blocks the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s: the ratio "
        f"reading's deciles for FAKE and for REAL blocks, from `jbcandidates.py`."
    )
    decile_head = "| label | blocks | " + " | ".join(f"p{p}" for p in DECILES) + " |"
    decile_rows = []
    for label, entry in run.real_veto_deciles.items():
        cells = [f"{v:.1f}" for v in entry["deciles"]] or ["none"] * len(DECILES)
        decile_rows.append(f"| {label} | {entry['blocks']} | " + " | ".join(cells) + " |")
    album_rows = []
    for name, entry in sorted(run.real_veto_albums.items()):
        median = f"{entry['median_ratio']:.1f}" if np.isfinite(entry["median_ratio"]) else "none"
        album_rows.append(f"| {name} | {entry['label']} | {entry['kept']} | {median} |")
    veto_intro = (
        f"For each line, every kept block whose ratio sits at or above it is forced to read real regardless of "
        f"{cand}'s own threshold call, and {cand}'s leave-one-album-out grade over the kept blocks is retaken with "
        f"that forcing in place."
    )
    veto_rows = [
        f"| {row['level']:g} dB | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.real_veto_sweep
    ]
    return [
        "## Real veto",
        "",
        intro,
        "",
        decile_head,
        "| --- | ---: | " + " | ".join("---:" for _ in DECILES) + " |",
        *decile_rows,
        "",
        f"### Per-album kept blocks at {MASK_SWEEP_ALBUM_LEVEL:g} dB",
        "",
        "| album | label | kept | median ratio |",
        "| --- | --- | ---: | ---: |",
        *album_rows,
        "",
        "### Veto sweep",
        "",
        veto_intro,
        "",
        f"| veto line | {cand} held-out wrong | {cand} held-out fake called real | {cand} held-out real called fake |",
        "| --- | ---: | ---: | ---: |",
        *veto_rows,
        "",
    ]
