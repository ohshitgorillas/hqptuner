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
    from collections.abc import Callable, Iterable, Iterator, Sequence

#: One candidate's leave-one-album-out totals, plus its wrong-side count per held-out album.
LoaoRow = dict[str, Any]


def album_groups(indices: Iterable[int], album_of_index: Callable[[int], str]) -> dict[str, list[int]]:
    """Group block indices by the album of the burst each block came from, albums in the order first seen."""
    out: dict[str, list[int]] = {}
    for i in indices:
        out.setdefault(album_of_index(i), []).append(i)
    return out


def held_out_folds(by_album: dict[str, list[int]], keep: Iterable[int]) -> Iterator[tuple[str, list[int], list[int]]]:
    """Yield ``(album, held, rest)`` per album: its blocks, and every other album's blocks of ``keep``.

    An album with no other album left in ``keep`` has no cut to be held out against, so it yields nothing.
    """
    kept = list(keep)
    for album, held in by_album.items():
        held_set = set(held)
        rest = [i for i in kept if i not in held_set]
        if rest:
            yield album, held, rest


def cut_over(rows: Sequence[tuple[str, float, str]], indices: Iterable[int]) -> dict[str, Any]:
    """Return the threshold one candidate's own values pick over the blocks at ``indices``."""
    chosen = list(indices)
    return best_threshold([rows[i][1] for i in chosen], [rows[i][2] for i in chosen])


def loao_calls(
    rows: Sequence[tuple[str, float, str]], album_of: dict[str, str], keep: Iterable[int]
) -> dict[int, bool]:
    """Per kept block with another album to be held out against: whether a cut over the other albums calls it fake."""
    kept = list(keep)
    out: dict[int, bool] = {}
    for _, held, rest in held_out_folds(album_groups(kept, lambda i: album_of[rows[i][0]]), kept):
        thr = cut_over(rows, rest)
        for i in held:
            out[i] = calls_fake(rows[i][1], thr)
    return out


def loao_total(blocks: int, by_album: dict[str, list[int]]) -> LoaoRow:
    """Return the empty wrong-side totals of a leave-one-album-out grade over ``blocks`` blocks."""
    return {
        "wrong": 0,
        "fake_called_real": 0,
        "real_called_fake": 0,
        "blocks": blocks,
        "albums": dict.fromkeys(by_album, 0),
    }


def count_wrong(total: LoaoRow, album: str, *, is_fake: bool) -> None:
    """Count one wrong-side block of ``album`` into the totals, on the side its own label says."""
    total["wrong"] += 1
    total["albums"][album] += 1
    total["fake_called_real" if is_fake else "real_called_fake"] += 1


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
    rows = block_rows[cand]
    wrong: dict[int, bool] = dict.fromkeys(keep, False)
    for i, called_fake in loao_calls(rows, album_of, keep).items():
        wrong[i] = called_fake != (rows[i][2] == "FAKE")
    return wrong


def loao_candidate(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    keep: Sequence[int],
    cand: str,
) -> LoaoRow:
    """Hold out each album in turn, cut over the rest, grade the held-out album, and sum over the albums."""
    rows = block_rows[cand]
    by_album = album_groups(keep, lambda i: album_of[rows[i][0]])
    wrong = loao_wrong(block_rows, album_of, keep, cand)
    total = loao_total(len(keep), by_album)
    for album, held in by_album.items():
        for i in held:
            if wrong[i]:
                count_wrong(total, album, is_fake=rows[i][2] == "FAKE")
    return total


def loao_table(
    block_rows: dict[str, list[tuple[str, float, str]]],
    album_of: dict[str, str],
    candidates: Sequence[str],
    keep: Sequence[int],
) -> dict[str, LoaoRow]:
    """One leave-one-album-out row per candidate over the kept blocks."""
    return {cand: loao_candidate(block_rows, album_of, keep, cand) for cand in candidates}
