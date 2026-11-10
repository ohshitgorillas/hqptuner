"""The two engine writes the server starts on its own wait for both lanes (docs/testing.md).

Auto-pilot's junk-filter move and the LIVE re-assert on a chain change are not requests, so the readiness gate never
sees them. Each case runs the real app on both fakes, takes the 8088 lane away by refusing its credentials, moves the
engine so the write falls due, and reads the 4321 fake's command log: nothing is sent while the lane is away, and the
write arrives once it is back. The app's clock moves only when the case advances it.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import advance_app, app_manager, wait_for_api
from fixtures_clients import Lanes, serve_lanes
from narrow import FixtureError

#: Poll passes the case lets the app take after the engine has moved, so the poll and auto-pilot's tick have both run.
PASSES = 3


def _ready(lanes: Lanes) -> bool:
    return bool(lanes.client.get("/api/health").json()["ready"])


def _lane_away(lanes: Lanes) -> None:
    lanes.http["_refuse_auth"] = True
    wait_for_api(lanes.client, lambda _client: not _ready(lanes))


def _lane_back(lanes: Lanes) -> None:
    lanes.http["_refuse_auth"] = False
    wait_for_api(lanes.client, lambda _client: _ready(lanes))


def _passes(lanes: Lanes) -> None:
    for _ in range(PASSES):
        advance_app(lanes.client, app_manager(lanes.client).cfg.poll_interval)


def _sent_after(lanes: Lanes, mark: int) -> list[str]:
    return [name for name, _attrs in lanes.control_log[mark:]]


@pytest.fixture
def autopilot_lanes(tmp_path: Path) -> Iterator[Lanes]:
    """Auto-pilot on, no metering verdict, and the engine holding the junk filter auto-pilot wants: nothing to move."""
    yield from serve_lanes(
        tmp_path, {"_junk_filters": "none xfi", "filter_junk": "0"}, advisor_enabled=True, hqp_home="/x/home"
    )


@pytest.fixture
def junk_filter_due(autopilot_lanes: Lanes) -> tuple[Lanes, int]:
    """The 8088 lane away and the engine moved off the filter auto-pilot wants; returns the lanes and the log mark."""
    lanes = autopilot_lanes
    if lanes.post("/api/autopilot", {"enabled": True}).status_code != 200:
        raise FixtureError(reason="auto-pilot would not switch on")
    _lane_away(lanes)
    mark = len(lanes.control_log)
    lanes.control["filter_junk"] = "1"
    _passes(lanes)
    return lanes, mark


def test_auto_pilot_sends_no_junk_filter_while_the_8088_lane_is_away(junk_filter_due: tuple[Lanes, int]) -> None:
    lanes, mark = junk_filter_due
    assert "SetJunkFilter" not in _sent_after(lanes, mark)


def test_auto_pilot_moves_the_junk_filter_once_the_8088_lane_is_back(junk_filter_due: tuple[Lanes, int]) -> None:
    lanes, _mark = junk_filter_due
    back = len(lanes.control_log)
    _lane_back(lanes)
    _passes(lanes)
    assert "SetJunkFilter" in _sent_after(lanes, back)


@pytest.fixture
def chain_entered_lanes(tmp_path: Path) -> Iterator[Lanes]:
    """The engine following its source on the PCM chain, with a LIVE value held for the dormant SDM chain."""
    yield from serve_lanes(tmp_path, {"mode": "0", "_active_mode": "PCM"})


@pytest.fixture
def chain_changed(chain_entered_lanes: Lanes) -> tuple[Lanes, int]:
    """A value held for the SDM chain, the 8088 lane away, and the engine then loading the SDM chain."""
    lanes = chain_entered_lanes
    held = lanes.post("/api/config/live", {"fields": {"oversampling": "23"}})
    if held.json()["report"]["stored"] != {"oversampling": "23"}:
        raise FixtureError(reason="the value for the dormant chain was not held")
    _lane_away(lanes)
    mark = len(lanes.control_log)
    lanes.control["_active_mode"] = "SDM (DSD)"
    _passes(lanes)
    return lanes, mark


def test_the_held_live_value_is_not_sent_when_the_chain_changes_while_the_8088_lane_is_away(
    chain_changed: tuple[Lanes, int],
) -> None:
    lanes, mark = chain_changed
    assert "SetFilter" not in _sent_after(lanes, mark)


def test_the_held_live_value_reaches_the_engine_once_the_8088_lane_is_back(chain_changed: tuple[Lanes, int]) -> None:
    lanes, _mark = chain_changed
    back = len(lanes.control_log)
    _lane_back(lanes)
    _passes(lanes)
    assert "SetFilter" in _sent_after(lanes, back)
