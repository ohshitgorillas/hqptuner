"""An edit to the chain the Engine has not loaded, at the routing lane.

Enumerations are mode-relative: `GetFilters` and `GetShapers` answer for the loaded chain
only, so a field of the other chain has no Engine value and no live setter reaches it
(`docs/spec/settings-truth.md` rule 10). Such an edit is not held for later: a LIVE batch
carrying one has no fallback lane, so the batch is refused before any setter runs.

The manager's readings put the Engine on one chain, with the enumerations of
`tests/support/fake_control.py`. Values are config-form enum IDs: PCM `filter` 40 is
`poly-sinc-gauss-long`, PCM `dither` 5 is `NS9`, SDM `oversampling` 23 is `sinc-M`, SDM
`modulator` 3 is `ASDM7EC`.
"""

from typing import NamedTuple

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
    {"index": "3", "name": "poly-sinc-short-mp", "value": "57"},
]
SDM_FILTERS = [
    {"index": "0", "name": "poly-sinc-gauss-long", "value": "38"},
    {"index": "1", "name": "sinc-M", "value": "23"},
    {"index": "2", "name": "poly-sinc-short-lp", "value": "57"},
]
PCM_SHAPERS = [{"index": "0", "name": "none", "value": "0"}, {"index": "1", "name": "NS9", "value": "5"}]
SDM_SHAPERS = [{"index": "0", "name": "ASDM5", "value": "0"}, {"index": "1", "name": "ASDM7EC", "value": "3"}]
JUNK_FILTERS = [{"index": "0", "name": "none"}, {"index": "1", "name": "20k"}, {"index": "2", "name": "30k"}]
PCM_RATES = [{"index": "0", "rate": "0"}, {"index": "1", "rate": "44100"}, {"index": "2", "rate": "352800"}]
SDM_RATES = [{"index": "0", "rate": "0"}, {"index": "1", "rate": "2822400"}]


class Chain(NamedTuple):
    """One loaded chain: its State mode index, the mode Status names, and its enumerations."""

    mode: str
    active_mode: str
    enums: dict[str, list[dict[str, str]]]


PCM = Chain(
    "1",
    "PCM",
    {"modes": MODES, "filters": PCM_FILTERS, "shapers": PCM_SHAPERS, "junk_filters": JUNK_FILTERS, "rates": PCM_RATES},
)
SDM = Chain(
    "2",
    "SDM (DSD)",
    {"modes": MODES, "filters": SDM_FILTERS, "shapers": SDM_SHAPERS, "junk_filters": JUNK_FILTERS, "rates": SDM_RATES},
)


def _manager(chain: Chain) -> ConnectionManager:
    """A bare manager whose readings put the Engine on ``chain``, every setting on index 0."""
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.enums = chain.enums
    mgr.readings.state = {
        "state": "0",
        "mode": chain.mode,
        "filter1x": "0",
        "filterNx": "0",
        "shaper": "0",
        "rate": "0",
        "filter_junk": "0",
        "adaptive": "0",
    }
    mgr.readings.status = {"state": "0", "active_mode": chain.active_mode}
    return mgr


class Batch(NamedTuple):
    """The chain the Engine has loaded, a batch carrying a field of the other one, and that field."""

    loaded: Chain
    fields: dict[str, str]
    unloaded: str


BATCHES = {
    "sdm-filter-alone-on-pcm": Batch(PCM, {"oversampling": "23"}, "oversampling"),
    "sdm-modulator-beside-a-pcm-filter": Batch(PCM, {"filter": "40", "modulator": "3"}, "modulator"),
    "pcm-dither-alone-on-sdm": Batch(SDM, {"dither": "5"}, "dither"),
    "pcm-filter-beside-an-sdm-filter": Batch(SDM, {"oversampling": "23", "filter": "40"}, "filter"),
}


@pytest.mark.parametrize("batch", BATCHES.values(), ids=BATCHES.keys())
def test_a_live_batch_with_an_unloaded_chain_field_is_refused_naming_that_field(batch: Batch) -> None:
    with pytest.raises(LiveRouteError, match=rf"\b{batch.unloaded}\b"):
        resolve_live(_manager(batch.loaded), dict(batch.fields))
