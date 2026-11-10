"""While the 8088 lane is down, own-store writes stay open and the 4321 reads are still answered (docs/testing.md).

The reads are attempted and bounded, and nothing relies on them: each is answered by its own route, from what the app
last read, without waiting on the control lane. ``detail`` is copy and is never asserted (rule 9).
"""

import httpx
import pytest
from apps import app_manager, app_of, wait_for_api
from fastapi.testclient import TestClient
from fixtures_clients import Lanes
from narrow import FixtureError
from virtual_clock import VirtualClock

#: The reads D-03 names, each with the status its own route answers with the 8088 lane away and metering off.
READS = [
    ("/api/state", 200),
    ("/api/status", 200),
    ("/api/enumerations", 200),
    ("/api/volume", 200),
    ("/api/log", 502),
    ("/api/livepresets/snapshot", 200),
    ("/api/meter/feed", 204),
]

#: Every Control API query the app issues, so a stalled fake leaves none of them answered.
QUERIES = (
    "State Status GetInfo GetLicense GetModes GetFilters GetShapers GetRates GetJunkFilters "
    "VolumeRange MatrixListProfiles MatrixGetProfile"
)


def _not_ready(client: TestClient) -> bool:
    return not client.get("/api/health").json()["ready"]


def take_8088_away(lanes: Lanes) -> None:
    lanes.http["_take_lane_down"]()
    wait_for_api(lanes.client, _not_ready)


async def virtual_seconds_taken_by(client: TestClient, method: str, path: str) -> float:
    """The virtual seconds the app's own loop spends answering ``method`` ``path``, on a clock where a reply that never
    comes runs out at its deadline."""
    clock = app_manager(client).clock
    if not isinstance(clock, VirtualClock):
        raise FixtureError(reason="the app does not run on a virtual clock")
    clock.fall_silent()
    transport = httpx.ASGITransport(app=app_of(client))
    async with httpx.AsyncClient(transport=transport, base_url="http://app", cookies=dict(client.cookies)) as http:
        started = clock.monotonic()
        await http.request(method, path, json={"level": "-20"} if method == "POST" else None)
        return clock.monotonic() - started


def seconds_taken(lanes: Lanes, method: str, path: str) -> float:
    portal = lanes.client.portal
    if portal is None:
        raise FixtureError(reason="the app's portal is not open")
    taken: float = portal.call(virtual_seconds_taken_by, lanes.client, method, path)
    return taken


def test_a_staged_edit_is_accepted_while_the_8088_lane_is_down(lanes: Lanes) -> None:
    take_8088_away(lanes)
    lanes.post("/api/config/stage", {"http": {"title": "Renamed"}})
    assert lanes.client.get("/api/config/pending").json()["http"]["title"] == "Renamed"


@pytest.mark.parametrize(("path", "status"), READS)
def test_a_read_is_answered_by_its_own_route_while_the_8088_lane_is_down(lanes: Lanes, path: str, status: int) -> None:
    take_8088_away(lanes)
    assert lanes.client.get(path).status_code == status


#: The reads served from what the app last read or from the metering reader: none of them has a reason to wait on the
#: control lane. `/api/log` is the other one, an 8088 page read, and is held to its own case below.
CONTROL_LANE_FREE = [path for path, _ in READS if path != "/api/log"]


@pytest.mark.parametrize("path", CONTROL_LANE_FREE)
def test_a_read_takes_less_than_the_control_lanes_deadline_while_the_4321_daemon_answers_nothing(
    lanes: Lanes, path: str
) -> None:
    take_8088_away(lanes)
    lanes.control["_stall"] = QUERIES
    assert seconds_taken(lanes, "GET", path) < app_manager(lanes.client).cfg.request_timeout


def test_the_log_is_still_answered_while_the_4321_daemon_answers_nothing(lanes: Lanes) -> None:
    # The 8088 page read waits on no 4321 reply, and with the lane away it is refused outright. A silent clock would run
    # its own 8088 deadline out whatever the page did, so this case reads the answer on the ordinary clock.
    take_8088_away(lanes)
    lanes.control["_stall"] = QUERIES
    assert lanes.client.get("/api/log").status_code == 502
