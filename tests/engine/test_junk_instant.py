"""The windowed minimum reports a fed level from the evidence in hand, whether
that evidence is a partial block or a full one.

Linear per-bin powers go straight into the public ``add`` and the contract comes
back through ``window_min_db`` — a level of L dB is a power of ``10 ** (L / 10)``.
"""

import pytest

from hqptuner.engine.metering import BLOCK_SECONDS, SpectralAggregate

BINS = 8
BANDWIDTH = 48000.0
TONE_BIN = 2
FLOOR_DB = -120.0


def _frame(level_db: float) -> list[float]:
    """A frame at the floor everywhere but ``TONE_BIN``, which carries ``level_db``."""
    mags = [float(10 ** (FLOOR_DB / 10))] * BINS
    mags[TONE_BIN] = float(10 ** (level_db / 10))
    return mags


@pytest.mark.parametrize("covered_seconds", [1.0, BLOCK_SECONDS], ids=["partial block", "full block"])
@pytest.mark.parametrize("level_db", [-53.5, -71.2], ids=["-53.5 dB", "-71.2 dB"])
def test_one_frame_reports_the_level_it_carried(level_db: float, covered_seconds: float) -> None:
    aggregate = SpectralAggregate(BINS, BANDWIDTH)
    aggregate.add(_frame(level_db), covered_seconds)
    assert (aggregate.window_min_db() or [])[TONE_BIN] == pytest.approx(level_db, abs=0.5)
