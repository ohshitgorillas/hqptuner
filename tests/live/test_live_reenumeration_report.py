"""Live callers learn whether their next edit needs freshly enumerated options."""

import pytest
from conftest import LiveManager

from hqptuner.lanes.live.lane import apply_now

PCM_MODE = "1"
SDM_MODE = "2"
PCM_FILTER_ID = "40"
SDM_FILTER_ID = "23"
PCM_SHAPER_ID = "5"
SDM_SHAPER_ID = "3"
PCM_RATE_HZ = "352800"
ENABLED = "1"


@pytest.mark.parametrize(
    ("mode", "field", "value", "reenumerated"),
    [
        (PCM_MODE, "mode", "sdm", True),
        (PCM_MODE, "filter1x", PCM_FILTER_ID, True),
        (PCM_MODE, "filter", PCM_FILTER_ID, True),
        (SDM_MODE, "oversampling1x", SDM_FILTER_ID, True),
        (SDM_MODE, "oversampling", SDM_FILTER_ID, True),
        (PCM_MODE, "dither", PCM_SHAPER_ID, False),
        (SDM_MODE, "modulator", SDM_SHAPER_ID, False),
        (PCM_MODE, "rate", PCM_RATE_HZ, False),
        (PCM_MODE, "junk_filter", ENABLED, False),
        (PCM_MODE, "adaptive_volume", ENABLED, False),
    ],
)
async def test_live_reports_identify_writes_that_refresh_the_next_edits_options(
    live_manager: LiveManager, mode: str, field: str, value: str, *, reenumerated: bool
) -> None:
    # Break: treating a filter alias as a separate setter loses its refresh signal.
    manager, _log, _state = await live_manager(mode=mode)
    report = await apply_now(manager, {field: value})
    assert report.reenumerated == reenumerated
