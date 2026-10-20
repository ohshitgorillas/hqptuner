"""A LIVE batch that cannot resolve whole is refused before any setter runs, naming the field.

A live write has no fallback lane and no Apply button to retry from, so a field the
running enumerations or State cannot translate refuses the batch rather than being
dropped (a dropped field would leave its control showing a value the engine never
took). Refused here: a field no live setter reaches, a flag value outside 0/1, an output
mode batched with anything else, and a `SetFilter` half State cannot complete.

The manager's readings put the Engine on the PCM chain with the tables below, which
mirror `tests/support/fake_control.py`. Each refusal must give a reason for the field
it names.
"""

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live.routing import LiveRouteError, resolve_live

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "SDM (DSD)", "value": "1"},
]
PCM_FILTERS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": "poly-sinc-gauss-long", "value": "40"},
    {"index": "2", "name": "sinc-M", "value": "25"},
]
PCM_SHAPERS = [{"index": "0", "name": "none", "value": "0"}, {"index": "1", "name": "NS9", "value": "5"}]
JUNK_FILTERS = [{"index": "0", "name": "none"}, {"index": "1", "name": "20k"}, {"index": "2", "name": "30k"}]
ENUMS = {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS, "junk_filters": JUNK_FILTERS}

#: State on a running PCM engine: both filter halves reported.
RUNNING_STATE = {"state": "0", "mode": "1", "filter1x": "0", "filterNx": "0", "shaper": "0", "filter_junk": "0"}
#: State from an engine that reports neither filter half.
NO_FILTER_STATE = {"state": "0", "mode": "1", "shaper": "0", "filter_junk": "0"}
#: The generation the Engine reading is taken in.
GENERATION = 1


def _manager(state: dict[str, str]) -> ConnectionManager:
    """A bare manager whose readings put the Engine on the PCM chain with ``state``."""
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.take_engine(GENERATION, state=dict(state), status={"state": "0", "active_mode": "PCM"}, enums=ENUMS)
    return mgr


def test_a_field_no_live_setter_reaches_refuses_the_batch_naming_it() -> None:
    with pytest.raises(LiveRouteError) as refused:
        resolve_live(_manager(RUNNING_STATE), {"alsa_period": "50", "dither": "5"})
    assert "alsa_period" in set(refused.value.reasons)


@pytest.mark.parametrize("value", ["01", "1.5", "2", "true"])
def test_an_adaptive_volume_value_outside_zero_and_one_refuses_the_batch(value: str) -> None:
    with pytest.raises(LiveRouteError) as refused:
        resolve_live(_manager(RUNNING_STATE), {"adaptive_volume": value})
    assert "adaptive_volume" in set(refused.value.reasons)


@pytest.mark.parametrize("beside", [{"junk_filter": "1"}, {"adaptive_volume": "1"}], ids=["junk-filter", "flag"])
def test_an_output_mode_beside_any_other_live_field_refuses_the_batch(beside: dict[str, str]) -> None:
    with pytest.raises(LiveRouteError) as refused:
        resolve_live(_manager(RUNNING_STATE), {"mode": "sdm", **beside})
    assert "mode" in set(refused.value.reasons)


@pytest.mark.parametrize(("field", "value"), [("filter", "40"), ("filter1x", "25")])
def test_a_filter_half_state_cannot_complete_refuses_the_batch_naming_it(field: str, value: str) -> None:
    with pytest.raises(LiveRouteError) as refused:
        resolve_live(_manager(NO_FILTER_STATE), {field: value})
    assert field in set(refused.value.reasons)
