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
    graded: list[str] = field(default_factory=list)
    unlabelled: list[str] = field(default_factory=list)
    duplicates: list[dict[str, str]] = field(default_factory=list)
    rows: Rows = field(default_factory=dict)
    parts: Parts = field(default_factory=dict)
    amt_cache: AmtCache = field(default_factory=dict)
    scored: Scored = field(default_factory=dict)
    guard_sweep: GuardSweep = field(default_factory=dict)
    amt_best: dict[str, dict[str, Any]] = field(default_factory=dict)
    albums: dict[str, dict[str, Any]] = field(default_factory=dict)
