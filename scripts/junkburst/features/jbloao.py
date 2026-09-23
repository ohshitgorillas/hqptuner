"""The leave-one-album-out grade: every album graded at a cut picked over every other album's blocks.

An in-sample cut is picked over the same blocks it then grades, so an album with enough blocks can pull the cut onto
itself. Here each album is held out in turn: the candidate's cut is swept over all the other albums' blocks, that
album's blocks are graded at it, and the wrong-side counts are summed over the albums. The totals sit beside the
in-sample row, so the distance between the two is the part of the in-sample score that is the cut fitting its own
corpus.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from jbthresholds import best_threshold, calls_fake

if TYPE_CHECKING:
    from collections.abc import Sequence

#: One candidate's leave-one-album-out totals, plus its wrong-side count per held-out album.
LoaoRow = dict[str, Any]


def _album_indices(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    keep: Sequence[int],
    cand: str,
) -> dict[str, list[int]]:
    """Group the kept block indices by the album of the burst each block came from."""
    out: dict[str, list[int]] = {}
    for i in keep:
        out.setdefault(album_of[block_rows[cand][i][0]], []).append(i)
    return out


def loao_wrong(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    keep: Sequence[int],
    cand: str,
) -> dict[int, bool]:
    """Per kept block index, cut over every other album's blocks: whether that block's own call is wrong.

    A block whose own album is the only one left in ``keep`` carries no cut to hold it out against and reads
    correct here, the same block ``loao_candidate`` leaves out of every one of its totals.
    """
    by_album = _album_indices(block_rows, album_of, keep, cand)
    rows = block_rows[cand]
    wrong: dict[int, bool] = dict.fromkeys(keep, False)
    for held in by_album.values():
        rest = [i for i in keep if i not in set(held)]
        if not rest:
            continue
        thr = best_threshold([rows[i][1] for i in rest], [rows[i][2] for i in rest])
        for i in held:
            _, value, label = rows[i]
            wrong[i] = calls_fake(value, thr) != (label == "FAKE")
    return wrong


def loao_candidate(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    keep: Sequence[int],
    cand: str,
) -> LoaoRow:
    """Hold out each album in turn, cut over the rest, grade the held-out album, and sum over the albums."""
    by_album = _album_indices(block_rows, album_of, keep, cand)
    rows = block_rows[cand]
    wrong = loao_wrong(block_rows, album_of, keep, cand)
    total: LoaoRow = {
        "wrong": 0,
        "fake_called_real": 0,
        "real_called_fake": 0,
        "blocks": len(keep),
        "albums": dict.fromkeys(by_album, 0),
    }
    for album, held in by_album.items():
        for i in held:
            if not wrong[i]:
                continue
            _, _, label = rows[i]
            is_fake = label == "FAKE"
            total["wrong"] += 1
            total["albums"][album] += 1
            total["fake_called_real" if is_fake else "real_called_fake"] += 1
    return total


def loao_table(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    candidates: Sequence[str],
    keep: Sequence[int],
) -> dict[str, LoaoRow]:
    """One leave-one-album-out row per candidate over the kept blocks."""
    return {cand: loao_candidate(block_rows, album_of, keep, cand) for cand in candidates}
