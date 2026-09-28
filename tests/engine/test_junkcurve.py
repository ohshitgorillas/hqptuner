"""Pin ``junkcurve.spur_corner`` on the 35 kHz tone bin.

Bin ``406`` on the 1025-bin, 0-88200 Hz grid is the 35 kHz tone, which reads
as the ``30k`` corner.
"""

from __future__ import annotations

from hqptuner.engine.junkcurve import hz, spur_corner

TONE_35K_BIN = 406
BINS = 1025
BANDWIDTH = 88200.0


def test_spur_corner_matches_junkadvisor_on_the_fixture_bin() -> None:
    frequency = hz(TONE_35K_BIN, BINS, BANDWIDTH)
    assert spur_corner(frequency) == "30k"
