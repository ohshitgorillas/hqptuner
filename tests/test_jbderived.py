"""``scripts/junkburst/jbderived.stats``: the percentile spread it reduces a list of values to.

Five values with a known rank, so ``p25`` and ``p75`` have an exact, hand-checkable answer under
the linear-interpolation percentile rule ``numpy.percentile`` defaults to. One assertion each
(docs/testing.md rule 2).
"""

from __future__ import annotations

from jbderived import stats
from jbscore import score_candidate, threshold

_RANKED_VALUES = [10.0, 20.0, 30.0, 40.0, 50.0]
_CLIFF_LOW = [10.0, 20.0]
_FULL_HIGH = [30.0, 80.0]


def test_stats_p25_is_the_25th_percentile_of_the_ranked_values() -> None:
    assert stats(_RANKED_VALUES).p25 == 20.0


def test_stats_p75_is_the_75th_percentile_of_the_ranked_values() -> None:
    assert stats(_RANKED_VALUES).p75 == 40.0


def test_score_candidate_is_none_when_neither_side_has_a_finite_reading() -> None:
    absent = {"cliff": [float("nan")], "full": [float("nan")]}
    present = {"cliff": _CLIFF_LOW, "full": _FULL_HIGH, "series": {}}
    assert (score_candidate(absent), score_candidate(present) is not None) == (None, True)


def test_threshold_midpoint_sits_between_the_facing_edges_when_the_cliff_side_is_lower() -> None:
    assert threshold(_CLIFF_LOW, _FULL_HIGH).midpoint == 27.0
