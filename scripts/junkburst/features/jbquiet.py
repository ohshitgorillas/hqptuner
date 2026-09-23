"""The quiet and loud halves the steady headline blocks divide into, and the two per-album tables read off them."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
from jbconfig import HEADLINE_WINDOW
from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from jbrun import Quiet, Rows, Scored

#: The candidates the quiet split is thresholded for, each read three times.
QUIET_CANDIDATES = ("A", "G", "GC", "H")
#: The three block sets every one of them is thresholded over.
SPLITS = ("all", "quiet", "loud")


def split_keep(flags: list[bool], split: str) -> list[int]:
    """Return the block indices one split keeps, in the order the rows carry them."""
    return [i for i, quiet in enumerate(flags) if split == "all" or quiet == (split == "quiet")]


def split_tables(rows: Rows, quiet: Quiet) -> dict[str, dict[str, dict[str, Any]]]:
    """Threshold A, G and GC over the steady headline blocks three times: all blocks, quiet only, loud only.

    Each split picks its own cut over the values that split leaves, rather than carrying the all-blocks cut across,
    so the quiet half is not scored against a threshold the loud half chose.
    """
    flags = quiet["steady"][HEADLINE_WINDOW]
    block_rows = rows["steady"][HEADLINE_WINDOW]
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for split in SPLITS:
        keep = split_keep(flags, split)
        out[split] = {
            cand: best_threshold([block_rows[cand][i][1] for i in keep], [block_rows[cand][i][2] for i in keep])
            for cand in QUIET_CANDIDATES
        }
    return out


def quiet_album_totals(
    rows: Rows, quiet: Quiet, split: dict[str, dict[str, dict[str, Any]]], row_key_of: dict[str, str]
) -> dict[str, dict[str, Any]]:
    """Per album row key over the quiet steady headline blocks: block count, G's wrong-side count, G's median value.

    A ``BY_TRACK`` album keys one row per track, ``row_key_of`` already carrying its own name.
    """
    thr = split["quiet"]["G"]
    flags = quiet["steady"][HEADLINE_WINDOW]
    out: dict[str, dict[str, Any]] = {}
    for (stamp, value, lab), is_quiet in zip(rows["steady"][HEADLINE_WINDOW]["G"], flags, strict=True):
        if not is_quiet:
            continue
        entry = out.setdefault(row_key_of[stamp], {"label": lab, "blocks": 0, "wrong": 0, "values": []})
        entry["blocks"] += 1
        entry["wrong"] += int(calls_fake(value, thr) != (lab == "FAKE"))
        if np.isfinite(value):
            entry["values"].append(float(value))
    for entry in out.values():
        entry["median"] = float(np.median(entry["values"])) if entry["values"] else float("nan")
    return out


def a_missed_albums(rows: Rows, scored: Scored, row_key_of: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Per album row key: the FAKE steady headline blocks A calls real, split by whether it carries a reading at all.

    A block with no reading is one A never had a number for; the rest sit on the real side of A's own cut. The split
    says which of the two a master's misses are, because only the second is a cut that could be moved.
    """
    thr = scored["steady"][HEADLINE_WINDOW]["A"]
    out: dict[str, dict[str, Any]] = {}
    for stamp, value, lab in rows["steady"][HEADLINE_WINDOW]["A"]:
        if lab != "FAKE" or calls_fake(value, thr):
            continue
        entry = out.setdefault(row_key_of[stamp], {"no_reading": 0, "below_cut": 0})
        entry["below_cut" if np.isfinite(value) else "no_reading"] += 1
    return out
