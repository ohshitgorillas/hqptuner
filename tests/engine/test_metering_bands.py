"""The three-band reduction a mini spectrum's bars are read from.

Every case builds a 1025-value frame of linear per-bin powers on a grid
spanning 0 Hz to the bandwidth it names, so bin ``i`` sits at
``i * bandwidth / 1024`` Hz — a level of L dB is a power of ``10 ** (L / 10)``,
as elsewhere in the metering suite. The frame's power sits in the bin nearest
one tone, and each case asks which of the three returned values stands above
both others.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from hqptuner.engine.metering import band_levels

if TYPE_CHECKING:
    from collections.abc import Sequence

BINS = 1025
FLOOR_POWER = 1e-12
TONE_POWER = 1.0

CD_BANDWIDTH = 22050.0
HIRES_BANDWIDTH = 96000.0


def _frame(tone_hz: float, bandwidth: float) -> list[float]:
    """A frame at the floor in every bin but the one nearest ``tone_hz``."""
    bin_hz = bandwidth / (BINS - 1)
    power = [FLOOR_POWER] * BINS
    power[round(tone_hz / bin_hz)] = TONE_POWER
    return power


def _tallest(values: Sequence[float]) -> int | None:
    """The one index standing above both others, or ``None`` where no single
    value does — three equal values name no band."""
    ranked = sorted(range(len(values)), key=lambda index: values[index], reverse=True)
    if values[ranked[0]] <= values[ranked[1]]:
        return None
    return ranked[0]


@pytest.mark.parametrize(
    ("tone_hz", "band"),
    [(100.0, 0), (1000.0, 1), (10000.0, 2)],
    ids=["100 Hz", "1 kHz", "10 kHz"],
)
def test_a_tone_stands_tallest_in_the_band_covering_it(tone_hz: float, band: int) -> None:
    assert _tallest(band_levels(_frame(tone_hz, CD_BANDWIDTH), CD_BANDWIDTH)) == band


@pytest.mark.parametrize("bandwidth", [CD_BANDWIDTH, HIRES_BANDWIDTH], ids=["22.05 kHz", "96 kHz"])
def test_a_2_khz_tone_stands_tallest_in_the_same_band_at_either_bandwidth(bandwidth: float) -> None:
    assert _tallest(band_levels(_frame(2000.0, bandwidth), bandwidth)) == 1
