"""Every field the register marks as a staged route is writable by the live lane.

A staged edit of such a field may be written by its setter instead of by a restore, so
the live lane must accept it on its own chain. A staged-route field the lane cannot route
would push its whole batch to the restart lane; the lane refuses it loudly instead.

The fields and their chains are the spec's "Fields with a setter" rows marked "Staged edit
can route live". Values are config-form enum IDs from the enumerations below.
"""

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.fields import query
from hqptuner.lanes.live.routing import LiveRouteError, resolve_live

ROUTED = "routed"
REFUSED = "refused"

MODES = [
    {"index": "0", "name": "[source]", "value": "-1"},
    {"index": "1", "name": "PCM", "value": "0"},
    {"index": "2", "name": "SDM (DSD)", "value": "1"},
]
JUNK = [{"index": "0", "name": "none"}]
PCM = (
    "1",
    "PCM",
    {
        "modes": MODES,
        "filters": [{"index": "0", "name": "none", "value": "0"}, {"index": "1", "name": "sinc-M", "value": "25"}],
        "shapers": [{"index": "0", "name": "none", "value": "0"}, {"index": "1", "name": "NS9", "value": "5"}],
        "junk_filters": JUNK,
        "rates": [{"index": "0", "rate": "0"}],
    },
)
SDM = (
    "2",
    "SDM (DSD)",
    {
        "modes": MODES,
        "filters": [{"index": "0", "name": "sinc-L", "value": "21"}, {"index": "1", "name": "sinc-M", "value": "23"}],
        "shapers": [{"index": "0", "name": "ASDM5", "value": "0"}, {"index": "1", "name": "ASDM7EC", "value": "3"}],
        "junk_filters": JUNK,
        "rates": [{"index": "0", "rate": "0"}],
    },
)

#: Each staged-route field with its chain and a value that chain enumerates.
STAGED_EDITS = {
    "mode": (PCM, "pcm"),
    "filter1x": (PCM, "25"),
    "filter": (PCM, "25"),
    "dither": (PCM, "5"),
    "oversampling1x": (SDM, "23"),
    "oversampling": (SDM, "23"),
    "modulator": (SDM, "3"),
}


def _manager(chain: tuple[str, str, dict[str, list[dict[str, str]]]]) -> ConnectionManager:
    """A bare manager whose readings put the Engine on ``chain``, every setting on index 0."""
    mode, active_mode, enums = chain
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.enums = enums
    mgr.readings.state = {
        "state": "0",
        "mode": mode,
        "filter1x": "0",
        "filterNx": "0",
        "shaper": "0",
        "rate": "0",
        "filter_junk": "0",
        "adaptive": "0",
    }
    mgr.readings.status = {"state": "0", "active_mode": active_mode}
    return mgr


def _route(name: str, chain: tuple[str, str, dict[str, list[dict[str, str]]]], value: str) -> str:
    """Whether the live lane routes a one-field batch of ``name`` on ``chain``."""
    try:
        resolve_live(_manager(chain), {name: value})
    except LiveRouteError:
        return REFUSED
    return ROUTED


@pytest.mark.parametrize("name", sorted(row.name for row in query.staged_routes()))
def test_the_live_lane_routes_every_field_the_register_marks_as_a_staged_route(name: str) -> None:
    chain, value = STAGED_EDITS.get(name, (PCM, "0"))
    assert _route(name, chain, value) == ROUTED


def test_the_live_lane_refuses_a_chain_field_the_engine_has_not_loaded() -> None:
    assert _route("modulator", PCM, "3") == REFUSED
