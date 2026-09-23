"""The mask reading over the steady headline blocks: its deciles, its per-album medians, and its level sweep.

``sweep_keep`` and the constants beside it are the line every other section reads its kept blocks from, so the real
veto (``jbveto.py``), the mirror candidate (``jbmirror.py``) and the edge candidates (``jbedge.py``) import them here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import MASK_SWEEP_WINDOWS
from jbloao import loao_candidate, loao_wrong

if TYPE_CHECKING:
    from jbrun import LabelledRun, MaskRow

#: The three numbers one block's mask reading carries, in the order the rows hold them.
MASK_READINGS = ("above-fold level", "ratio", "correlation")
#: Decile points every reading is reported at.
DECILES = tuple(range(0, 101, 10))
#: The four block sets every reading's deciles are split into: the owner's label crossed with the quiet tag.
MASK_SPLITS = ("FAKE quiet", "FAKE loud", "REAL quiet", "REAL loud")
#: Level lines the sweep reads, in the block's own above-fold level in dB.
MASK_SWEEP_LEVELS = (-140.0, -135.0, -130.0, -125.0, -120.0, -115.0)
#: The one line the per-album sweep table is read at.
MASK_SWEEP_ALBUM_LEVEL = -125.0
#: The candidate the sweep grades its kept blocks with.
MASK_SWEEP_CANDIDATE = "G"
#: One block set's two labels, in the order the sweep row carries them.
SWEEP_LABELS = ("FAKE", "REAL")
#: ``block_rows[candidate]`` is one (stamp, value, label) per steady headline block, the order the mask rows carry.
BlockRows = dict[str, list[tuple[str, float, str]]]


def _values(row: MaskRow) -> tuple[float, float, float]:
    """Return the three readings of one row, in ``MASK_READINGS`` order."""
    return row[2], row[3], row[4]


def _split_of(label: str, *, quiet: bool) -> str:
    """Return the split one block falls in, from its owner label and its quiet tag."""
    return f"{label} {'quiet' if quiet else 'loud'}"


def mask_deciles(rows: list[MaskRow], flags: list[bool]) -> dict[str, dict[str, dict[str, Any]]]:
    """Per reading and per split: the blocks carrying a reading, and p0 to p100 of it over them.

    A block with no reading is counted nowhere: a NaN level is not a low level, and averaging it in either
    direction would read as a measurement.
    """
    kept: dict[str, dict[str, list[float]]] = {r: {s: [] for s in MASK_SPLITS} for r in MASK_READINGS}
    for row, quiet in zip(rows, flags, strict=True):
        split = _split_of(row[1], quiet=quiet)
        for reading, value in zip(MASK_READINGS, _values(row), strict=True):
            if np.isfinite(value):
                kept[reading][split].append(float(value))
    return {
        reading: {
            split: {
                "blocks": len(values),
                "deciles": [float(np.percentile(values, p)) for p in DECILES] if values else [],
            }
            for split, values in splits.items()
        }
        for reading, splits in kept.items()
    }


def mask_album_totals(rows: list[MaskRow], row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key over the steady headline blocks: its label, block count and the median of all three readings.

    A ``BY_TRACK`` album keys one row per track, ``row_key_of`` already carrying its own name.
    """
    kept: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = kept.setdefault(
            row_key_of[row[0]], {"label": row[1], "blocks": 0, "values": {r: [] for r in MASK_READINGS}}
        )
        entry["blocks"] += 1
        for reading, value in zip(MASK_READINGS, _values(row), strict=True):
            if np.isfinite(value):
                entry["values"][reading].append(float(value))
    for entry in kept.values():
        entry["median"] = {
            reading: (float(np.median(values)) if values else float("nan"))
            for reading, values in entry["values"].items()
        }
    return kept


def mask_tables(
    rows: list[MaskRow], flags: list[bool], row_key_of: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Both mask tables off the steady headline blocks: the decile split and the per-album medians."""
    return mask_deciles(rows, flags), mask_album_totals(rows, row_key_of)


def sweep_keep(rows: list[MaskRow], level: float) -> list[int]:
    """Block indices whose above-fold level sits at or above the line; a block with no reading is dropped.

    A NaN level is no reading rather than a low one, so the mask cannot say the block clears the line and the block
    is not kept.
    """
    return [i for i, row in enumerate(rows) if np.isfinite(row[2]) and row[2] >= level]


def _kept_dropped(rows: list[MaskRow], kept: set[int]) -> dict[str, dict[str, int]]:
    """Per label, how many of the blocks the line keeps and how many it drops."""
    counts = {label: {"kept": 0, "dropped": 0} for label in SWEEP_LABELS}
    for i, row in enumerate(rows):
        counts[row[1]]["kept" if i in kept else "dropped"] += 1
    return counts


def mask_sweep_row(
    rows: list[MaskRow], block_rows: BlockRows, album_of: dict[str, str], level: float
) -> dict[str, Any]:
    """One level line: its kept and dropped blocks per label, the fake albums still carrying one, and G held out.

    The leave-one-album-out grade runs over the kept blocks alone, so each album's cut is picked over the other
    albums' kept blocks rather than over blocks the line has already thrown away.
    """
    keep = sweep_keep(rows, level)
    kept = set(keep)
    fake_albums = {album_of[rows[i][0]] for i in keep if rows[i][1] == "FAKE"}
    return {
        "level": float(level),
        "counts": _kept_dropped(rows, kept),
        "fake_albums": len(fake_albums),
        "loao": loao_candidate(block_rows, album_of, keep, MASK_SWEEP_CANDIDATE),
    }


def mask_sweep_albums(
    rows: list[MaskRow],
    block_rows: BlockRows,
    keys_of: dict[str, tuple[str, str]],
    level: float,
    steps: list[float],
) -> dict[str, dict[str, Any]]:
    """Per album row key at one line: its kept and dropped blocks, G's held-out wrong, and its median signed G step.

    ``keys_of[stamp]`` is ``(row key, true album)``: the median step is taken over the kept blocks alone and keeps
    its sign, so an album whose curve steps down across the fold does not read the same as one stepping up by as
    much. G's held-out cut is still swept per true album, but a ``BY_TRACK`` album's wrong count is summed over
    that track's own kept blocks rather than repeated from the album total.
    """
    album_of = {stamp: album for stamp, (_, album) in keys_of.items()}
    keep = sweep_keep(rows, level)
    kept = set(keep)
    wrong = loao_wrong(block_rows, album_of, keep, MASK_SWEEP_CANDIDATE)
    out: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows):
        row_key, album = keys_of[row[0]]
        entry = out.setdefault(
            row_key, {"album": album, "label": row[1], "kept": 0, "dropped": 0, "wrong": 0, "steps": []}
        )
        entry["kept" if i in kept else "dropped"] += 1
        if i in kept:
            if wrong[i]:
                entry["wrong"] += 1
            if np.isfinite(steps[i]):
                entry["steps"].append(float(steps[i]))
    for entry in out.values():
        entry["median_step"] = float(np.median(entry["steps"])) if entry["steps"] else float("nan")
    return out


def mask_sweep(
    mask_by_window: dict[float, list[MaskRow]],
    rows_by_window: dict[float, BlockRows],
    album_of: dict[str, str],
    row_key_of: dict[str, str],
    steps_by_window: dict[float, list[float]],
) -> tuple[dict[float, list[dict[str, Any]]], dict[float, dict[str, dict[str, Any]]]]:
    """Return the sweep off the steady blocks at each of ``MASK_SWEEP_WINDOWS``, mask reading and G at that length."""
    keys_of = {stamp: (row_key_of[stamp], album) for stamp, album in album_of.items()}
    sweep: dict[float, list[dict[str, Any]]] = {}
    albums: dict[float, dict[str, dict[str, Any]]] = {}
    for window in MASK_SWEEP_WINDOWS:
        rows, block_rows = mask_by_window[window], rows_by_window[window]
        sweep[window] = [mask_sweep_row(rows, block_rows, album_of, level) for level in MASK_SWEEP_LEVELS]
        albums[window] = mask_sweep_albums(rows, block_rows, keys_of, MASK_SWEEP_ALBUM_LEVEL, steps_by_window[window])
    return sweep, albums


def _sweep_rows(rows: list[dict[str, Any]]) -> list[str]:
    """Return one markdown row per level line."""
    out = []
    for row in rows:
        counts, loao = row["counts"], row["loao"]
        cells = " | ".join(f"{counts[label][side]}" for label in SWEEP_LABELS for side in ("kept", "dropped"))
        out.append(
            f"| {row['level']:g} dB | {cells} | {row['fake_albums']} | {loao['wrong']} | "
            f"{loao['fake_called_real']} | {loao['real_called_fake']} |"
        )
    return out


def _sweep_album_rows(albums: dict[str, dict[str, Any]]) -> list[str]:
    """Return one markdown row per album at the line the per-album table is read at."""
    out = []
    for name, entry in sorted(albums.items()):
        step = f"{entry['median_step']:+.2f}" if np.isfinite(entry["median_step"]) else "none"
        out.append(f"| {name} | {entry['label']} | {entry['kept']} | {entry['dropped']} | {entry['wrong']} | {step} |")
    return out


def _sweep_window_section(window: float, rows: list[dict[str, Any]], albums: dict[str, dict[str, Any]]) -> list[str]:
    """Return one window's sweep table and per-album table."""
    cand = MASK_SWEEP_CANDIDATE
    head = (
        "| level | FAKE kept | FAKE dropped | REAL kept | REAL dropped | fake albums with a kept block | "
        f"{cand} held-out wrong | {cand} held-out fake called real | {cand} held-out real called fake |"
    )
    album_intro = (
        f"Steady blocks only, {cand} held out over the blocks that line keeps, mask reading and {cand} both read "
        f"at this block length. The last column is the median of the signed step {cand} is the absolute value of, "
        f"over the blocks that line keeps."
    )
    return [
        f"### {window:g} s blocks",
        "",
        head,
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        *_sweep_rows(rows),
        "",
        f"#### Per-album kept blocks at {MASK_SWEEP_ALBUM_LEVEL:g} dB, {window:g} s blocks",
        "",
        album_intro,
        "",
        f"| album | label | kept | dropped | {cand} held-out wrong | median signed {cand} step (dB) |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
        *_sweep_album_rows(albums),
        "",
    ]


def mask_sweep_section(run: LabelledRun) -> list[str]:
    """Return the report's mask sweep section: each of ``MASK_SWEEP_WINDOWS`` with its own sweep and per-album table."""
    cand = MASK_SWEEP_CANDIDATE
    intro = (
        f"Steady blocks only. Each line keeps the blocks whose above-fold level from the section above sits at or "
        f"above it, and drops the rest; a block carrying no reading is dropped. The fake album column counts the "
        f"albums the owner calls FAKE that still carry at least one kept block, so a line that reads cleanly by "
        f"dropping whole masters says so. {cand} is then graded over the kept blocks alone, each album held out in "
        f"turn and its cut picked over the other albums' kept blocks. The mask reading and {cand} are both read at "
        f"the block's own length, one table per length in " + ", ".join(f"{w:g} s" for w in MASK_SWEEP_WINDOWS) + "."
    )
    out = ["## Mask sweep", "", intro, ""]
    for window in MASK_SWEEP_WINDOWS:
        out += _sweep_window_section(window, run.mask_sweep[window], run.mask_sweep_albums[window])
    return out
