"""How a rate in Hz is classified into an output family (docs/testing.md).

A rate in Hz belongs to one of the two output families, PCM or SDM, and the
config side carries a separate limit field for each — `defaults_samplerate` and
`defaults_bitrate`. What this file covers is that classification, and the fact
that a family with nothing pinned in the engine reports no live limit at all.

Everything here runs against the stateful fake daemon over a real socket: the
assertions are on what the manager reports, never on how it was produced.
"""

import pytest
from conftest import LiveManager

from hqptuner.lanes.live import chain, overrides

# --- which family a rate belongs to -----------------------------------------
# The split is the lowest SDM rate: DSD64 is 2822400 Hz on a 44.1k base and no
# PCM rate the engine offers reaches it.


@pytest.mark.parametrize(
    ("hz", "family"),
    [("44100", "pcm"), ("192000", "pcm"), ("768000", "pcm"), ("2822400", "sdm"), ("22579200", "sdm")],
)
def test_a_rate_names_the_output_family_it_belongs_to(hz: str, family: str) -> None:
    assert chain.rate_family(hz) == family


@pytest.mark.parametrize("field", ["defaults_samplerate", "defaults_bitrate"])
async def test_a_family_with_no_pin_reports_no_rate_limit(live_manager: LiveManager, field: str) -> None:
    # `State rate="0"` is the engine's Auto: it pins nothing, and reporting a
    # limit off it would write a rate the user never picked.
    manager, _, _ = await live_manager()
    assert field not in overrides.live_overrides(manager)
