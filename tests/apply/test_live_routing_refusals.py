"""What live routing refuses or hands back to the restore lane, against the fake control daemon.

A field routes live only when the whole translation succeeds (``hqptuner/lanes/live/routing.py``): a mode the form
does not name, a one-sided filter edit whose sibling the daemon's State cannot supply, and a field neither live
table carries each fall back instead of reaching a setter. The manager is connected to the real-socket fake; the
fake's State is moved between polls by writing to its shared dict. Enum 40 is poly-sinc-gauss-long at PCM index 1
and both filter slots start at index 0.
"""

import pytest
from apps import advanced
from conftest import LiveManager
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.live import routing
from hqptuner.lanes.live.chain import PCM

#: Poll passes the manager gets to read a State the fake has been moved to.
POLLS = 20


async def _state_read_without(mgr: ConnectionManager, state: dict[str, str], clock: VirtualClock, key: str) -> None:
    """Drop ``key`` from the fake's State and return once the manager's poll has read a State without it."""
    del state[key]
    for _ in range(POLLS):
        read = mgr.readings.state
        if read is not None and key not in read:
            return
        await advanced(clock, mgr.cfg.poll_interval)
    raise FixtureError(reason="the manager never read the State the case arranged")


def _refusal(mgr: ConnectionManager, fields: dict[str, str]) -> routing.LiveRouteError:
    """The error ``resolve_live`` raises for ``fields``."""
    try:
        routing.resolve_live(mgr, fields)
    except routing.LiveRouteError as refused:
        return refused
    raise FixtureError(reason="the batch resolved, so there was nothing to refuse")


async def test_a_mode_the_form_does_not_name_stays_on_the_restore_lane(live_manager: LiveManager) -> None:
    mgr, _log, _state = await live_manager()
    _, rest = routing.split_live(mgr, {"mode": "stereo"}, {})
    assert rest == {"mode": "stereo"}


@pytest.mark.parametrize(("sibling_known", "rest"), [(True, {}), (False, {"filter1x": "40"})])
async def test_a_one_sided_filter_edit_routes_live_only_while_state_carries_its_sibling(
    live_manager: LiveManager, clock: VirtualClock, *, sibling_known: bool, rest: dict[str, str]
) -> None:
    mgr, _log, state = await live_manager()
    if not sibling_known:
        await _state_read_without(mgr, state, clock, "filterNx")
    _, left = routing.split_live(mgr, {"filter1x": "40"}, {})
    assert left == rest


async def test_a_one_sided_filter_edit_is_refused_live_while_state_lacks_its_sibling(
    live_manager: LiveManager, clock: VirtualClock
) -> None:
    mgr, _log, state = await live_manager()
    await _state_read_without(mgr, state, clock, "filterNx")
    assert _refusal(mgr, {"filter1x": "40"}).reasons.keys() == {"filter1x"}


async def test_a_field_neither_live_table_carries_is_refused(live_manager: LiveManager) -> None:
    mgr, _log, _state = await live_manager()
    assert _refusal(mgr, {"channels": "2"}).reasons.keys() == {"channels"}


@pytest.mark.parametrize(
    ("sibling_known", "edits"),
    [(True, {"filter": {"value1x": "1", "value": "0"}}), (False, {})],
)
async def test_a_remembered_chain_reasserts_a_filter_only_while_state_carries_the_other_half(
    live_manager: LiveManager, clock: VirtualClock, *, sibling_known: bool, edits: dict[str, dict[str, str]]
) -> None:
    mgr, _log, state = await live_manager()
    mgr.readings.live.chain[PCM] = {"filter1x": "40"}
    if not sibling_known:
        await _state_read_without(mgr, state, clock, "filterNx")
    assert routing.resolve_chain(mgr, PCM)[0] == edits
