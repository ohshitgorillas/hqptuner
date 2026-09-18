"""The record one owner-labelled run produces, handed whole to the printers and to the report writer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from jbthresholds import PartRow

#: ``rows[group][window][candidate]`` is one (stamp, value, label) per block.
Rows = dict[str, dict[float, dict[str, list[tuple[str, float, str]]]]]
#: ``parts[group][window]`` holds each block's E2 and E3 parts, so a guard can be swept without reading captures again.
Parts = dict[str, dict[float, list[PartRow]]]
#: ``amt_cache[group]`` holds (stamp, AM value, label, near-edge spread median, reference spread median) per block at
#: the headline window, so AMT's veto factor can be swept without reading the captures again.
AmtCache = dict[str, list[tuple[str, float, str, float, float]]]
#: ``quiet[group][window]`` is one quiet flag per block, in the same order as every candidate's rows.
Quiet = dict[str, dict[float, list[bool]]]
#: One block's mask reading: its stamp, its owner label, the above-fold level, the ratio and the correlation.
MaskRow = tuple[str, str, float, float, float]
#: ``mask[group][window]`` holds one such row per block at that window, in the same order as ``quiet``'s flags at that
#: window. Only the windows in ``jbconfig.MASK_SWEEP_WINDOWS`` are scored.
Mask = dict[str, dict[float, list[MaskRow]]]
#: ``mirror[group][window]`` is one (stamp, M value, label) per block, in the same order as ``mask``'s rows.
Mirror = dict[str, dict[float, list[tuple[str, float, str]]]]
#: ``gstep[group][window]`` is one signed G step per block, in the same order as ``mask``'s rows.
GStep = dict[str, dict[float, list[float]]]
#: ``edge[group][candidate]`` is one (stamp, value, label) per block at the headline window, in the same order as
#: ``mask``'s rows there. P, G90 and S are read at that window alone.
Edge = dict[str, dict[str, list[tuple[str, float, str]]]]
#: ``scored[group][window][candidate]`` is that candidate's chosen threshold and its wrong-side counts.
Scored = dict[str, dict[float, dict[str, dict[str, Any]]]]
#: ``guard_sweep[group][candidate]`` is one row per guard value.
GuardSweep = dict[str, dict[str, list[dict[str, Any]]]]


@dataclass
class LabelledRun:
    """Every input, value and verdict of one ``report --labels`` run."""

    tracks: dict[str, dict[str, str]] = field(default_factory=dict)
    stamps: list[str] = field(default_factory=list)
    owner: dict[str, str | None] = field(default_factory=dict)
    group_of: dict[str, str] = field(default_factory=dict)
    album_of: dict[str, str] = field(default_factory=dict)
    #: Per stamp, the key a per-album table rows it under: the album name, or ``"{album} — {track}"`` where the
    #: owner's ``labels.tsv`` album row reads ``BY_TRACK``. Leave-one-album-out grading stays on ``album_of``.
    row_key_of: dict[str, str] = field(default_factory=dict)
    graded: list[str] = field(default_factory=list)
    unlabelled: list[str] = field(default_factory=list)
    duplicates: list[dict[str, str]] = field(default_factory=list)
    rows: Rows = field(default_factory=dict)
    parts: Parts = field(default_factory=dict)
    amt_cache: AmtCache = field(default_factory=dict)
    quiet: Quiet = field(default_factory=dict)
    mask: Mask = field(default_factory=dict)
    mirror: Mirror = field(default_factory=dict)
    gstep: GStep = field(default_factory=dict)
    edge: Edge = field(default_factory=dict)
    #: ``edge_deciles[candidate][label]`` is the block count and p0 to p100 of that candidate over the blocks the
    #: mask sweep's album line keeps at the headline window, split FAKE from REAL.
    edge_deciles: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    #: ``edge_albums[album]`` is that album's label, its kept block count there, and its median P, G90 and S.
    edge_albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: One row per graded rule — P, G90 and S alone, then each of them with G — under the ratio veto.
    edge_grades: list[dict[str, Any]] = field(default_factory=list)
    #: One row per ``jbpolicy.LOUD_FRAME_CUTS`` value: G90 alone against that fixed cut over the blocks the album
    #: line keeps, its wrong-side counts, and the wrong count per album or track row key.
    loud_frame_sweep: list[dict[str, Any]] = field(default_factory=list)
    #: The policy grade: how many bursts it covers, one row per graded rule, and the per-block table for the one
    #: row key ``jbpolicy.POLICY_BLOCK_KEY`` names.
    policy_grade: dict[str, Any] = field(default_factory=dict)
    #: ``mirror_deciles[label]`` is the block count and p0 to p100 of M over the blocks the mask sweep's album line
    #: keeps at the headline window, split FAKE from REAL.
    mirror_deciles: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: ``mirror_albums[album]`` is that album's label, its kept block count there, and the median M over them.
    mirror_albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: One row per graded rule — M alone, then G or M — each with the veto line in place.
    mirror_grades: list[dict[str, Any]] = field(default_factory=list)
    #: ``mask_deciles[reading][split]`` is the block count and p0 to p100 of that reading over the steady headline
    #: blocks of that split.
    mask_deciles: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    #: ``mask_albums[album]`` is that album's label, its steady headline block count and its three medians.
    mask_albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: ``mask_sweep[window]`` is one row per mask level line at that window: its kept and dropped blocks per label,
    #: its fake albums, and G held out on them.
    mask_sweep: dict[float, list[dict[str, Any]]] = field(default_factory=dict)
    #: ``mask_sweep_albums[window][album]`` is that album's kept and dropped blocks at the album line for that
    #: window, and G's held-out wrong there.
    mask_sweep_albums: dict[float, dict[str, dict[str, Any]]] = field(default_factory=dict)
    #: ``real_veto_deciles[label]`` is the block count and p0 to p100 of the ratio reading, over the blocks the mask
    #: sweep's album line keeps at the headline window, split FAKE from REAL.
    real_veto_deciles: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: ``real_veto_albums[album]`` is that album's label, its kept block count there, and the median ratio over them.
    real_veto_albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: One row per veto line: G's leave-one-album-out grade over the same kept blocks, with every block whose ratio
    #: sits at or above the line forced to read real.
    real_veto_sweep: list[dict[str, Any]] = field(default_factory=list)
    scored: Scored = field(default_factory=dict)
    guard_sweep: GuardSweep = field(default_factory=dict)
    amt_best: dict[str, dict[str, Any]] = field(default_factory=dict)
    albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    split_scored: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    quiet_albums: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: ``loao[candidate]`` over every steady headline block, each album graded at a cut picked without it.
    loao: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: ``loao_split[split][candidate]``, the same grade taken inside the all, quiet and loud splits.
    loao_split: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    a_missed: dict[str, dict[str, Any]] = field(default_factory=dict)
