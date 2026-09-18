"""The mirror candidate M: its deciles over the kept blocks, its per-album medians, and the rules it is graded in."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbmask import DECILES, MASK_SWEEP_ALBUM_LEVEL, MASK_SWEEP_CANDIDATE, SWEEP_LABELS, sweep_keep
from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from jbrun import LabelledRun, MaskRow


#: The candidate the mirror section grades, and the ratio line its veto forces real at.
MIRROR_CANDIDATE = "M"
MIRROR_VETO_LEVEL = -15.0


def mirror_deciles(rows: list[tuple[str, float, str]]) -> dict[str, dict[str, Any]]:
    """Return M's deciles over the kept blocks, split FAKE from REAL; a block with no reading is counted nowhere."""
    kept: dict[str, list[float]] = {label: [] for label in SWEEP_LABELS}
    for _, value, label in rows:
        if np.isfinite(value):
            kept[label].append(float(value))
    return {
        label: {
            "blocks": len(values),
            "deciles": [float(np.percentile(values, p)) for p in DECILES] if values else [],
        }
        for label, values in kept.items()
    }


def mirror_albums(rows: list[tuple[str, float, str]], row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key over the kept blocks: its label, its kept block count, and the median M over them."""
    out: dict[str, dict[str, Any]] = {}
    for stamp, value, label in rows:
        entry = out.setdefault(row_key_of[stamp], {"label": label, "kept": 0, "values": []})
        entry["kept"] += 1
        if np.isfinite(value):
            entry["values"].append(float(value))
    for entry in out.values():
        entry["median"] = float(np.median(entry["values"])) if entry["values"] else float("nan")
    return out


def _any_call(
    mask_row: MaskRow,
    candidates: list[list[tuple[str, float, str]]],
    thrs: list[dict[str, Any]],
    index: int,
    veto_level: float,
) -> bool:
    """One block's verdict: fake when any candidate's own cut calls it fake, unless the veto line forces it real."""
    if np.isfinite(mask_row[3]) and mask_row[3] >= veto_level:
        return False
    return any(calls_fake(rows[index][1], thr) for rows, thr in zip(candidates, thrs, strict=True))


def veto_loao_any(
    mask_rows: list[MaskRow],
    candidates: list[list[tuple[str, float, str]]],
    album_of: dict[str, str],
    veto_level: float,
) -> dict[str, Any]:
    """Leave-one-album-out over the kept blocks for a rule reading fake when any of its candidates does.

    Each candidate's cut is picked over the other albums' kept blocks, unforced; the held-out block's call is the
    veto-forced one. One candidate in ``candidates`` grades that candidate alone.
    """
    first = candidates[0]
    by_album: dict[str, list[int]] = {}
    for i in range(len(mask_rows)):
        by_album.setdefault(album_of[first[i][0]], []).append(i)
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
        thrs = [best_threshold([rows[i][1] for i in rest], [rows[i][2] for i in rest]) for rows in candidates]
        for i in held:
            is_fake = first[i][2] == "FAKE"
            if _any_call(mask_rows[i], candidates, thrs, i, veto_level) == is_fake:
                continue
            total["wrong"] += 1
            total["albums"][album] += 1
            total["fake_called_real" if is_fake else "real_called_fake"] += 1
    return total


def mirror_tables(
    rows: list[MaskRow],
    g_rows: list[tuple[str, float, str]],
    m_rows: list[tuple[str, float, str]],
    album_of: dict[str, str],
    row_key_of: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Return the mirror section's three parts: M's deciles, its per-album table, and the two graded rules.

    ``rows``, ``g_rows`` and ``m_rows`` are the full steady headline blocks; every part is read over the blocks the
    mask sweep's album line keeps out of them.
    """
    keep = sweep_keep(rows, MASK_SWEEP_ALBUM_LEVEL)
    kept_rows = [rows[i] for i in keep]
    kept_g = [g_rows[i] for i in keep]
    kept_m = [m_rows[i] for i in keep]
    grades = [
        {"rule": MIRROR_CANDIDATE, **veto_loao_any(kept_rows, [kept_m], album_of, MIRROR_VETO_LEVEL)},
        {
            "rule": f"{MASK_SWEEP_CANDIDATE} or {MIRROR_CANDIDATE}",
            **veto_loao_any(kept_rows, [kept_g, kept_m], album_of, MIRROR_VETO_LEVEL),
        },
    ]
    return mirror_deciles(kept_m), mirror_albums(kept_m, row_key_of), grades


def mirror_section(run: LabelledRun) -> list[str]:
    """Return the report's mirror section: M's deciles, its per-album table, then M alone and G or M."""
    cand, other = MIRROR_CANDIDATE, MASK_SWEEP_CANDIDATE
    intro = (
        f"Over the blocks the {MASK_SWEEP_ALBUM_LEVEL:g} dB line keeps at {HEADLINE_WINDOW:g} s: {cand}'s deciles "
        f"for FAKE and for REAL blocks, from `jbcandidates.py`."
    )
    decile_head = "| label | blocks | " + " | ".join(f"p{p}" for p in DECILES) + " |"
    decile_rows = []
    for label, entry in run.mirror_deciles.items():
        cells = [f"{v:.3f}" for v in entry["deciles"]] or ["none"] * len(DECILES)
        decile_rows.append(f"| {label} | {entry['blocks']} | " + " | ".join(cells) + " |")
    album_rows = []
    for name, entry in sorted(run.mirror_albums.items()):
        median = f"{entry['median']:.3f}" if np.isfinite(entry["median"]) else "none"
        album_rows.append(f"| {name} | {entry['label']} | {entry['kept']} | {median} |")
    grade_intro = (
        f"Both rules are graded over the same kept blocks with each album held out in turn and every cut picked "
        f"over the other albums' kept blocks, the {MIRROR_VETO_LEVEL:g} dB ratio veto forcing a block real whatever "
        f"the cuts say. The second rule reads fake when {other} clears its cut or {cand} clears its own."
    )
    grade_rows = [
        f"| {row['rule']} | {row['wrong']} | {row['fake_called_real']} | {row['real_called_fake']} |"
        for row in run.mirror_grades
    ]
    return [
        "## Mirror",
        "",
        intro,
        "",
        decile_head,
        "| --- | ---: | " + " | ".join("---:" for _ in DECILES) + " |",
        *decile_rows,
        "",
        f"### Per-album kept blocks at {MASK_SWEEP_ALBUM_LEVEL:g} dB",
        "",
        f"| album | label | kept | median {cand} |",
        "| --- | --- | ---: | ---: |",
        *album_rows,
        "",
        "### Held-out grades",
        "",
        grade_intro,
        "",
        "| rule | held-out wrong | held-out fake called real | held-out real called fake |",
        "| --- | ---: | ---: | ---: |",
        *grade_rows,
        "",
    ]
