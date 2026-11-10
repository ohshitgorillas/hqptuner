"""While either lane is down, the six engine writes are refused and the 4321 daemon is sent nothing (docs/testing.md).

Each case runs the real app, ready and logged in, on both fakes, then takes one lane away mid-run and lets a poll record
it. The cause-to-code mapping belongs to ``test_ready_refusal``; these cases assert a refusal and a silent wire, not
which refusal. ``detail`` is copy and is never asserted (rule 9).
"""

from collections.abc import Callable
from typing import Any

import pytest
from apps import app_manager, wait_for_api
from fastapi.testclient import TestClient
from fixtures_clients import Lanes
from narrow import FixtureError

#: The routes the readiness gate holds, each with a body the route would act on were the app ready.
ENGINE_WRITES: list[tuple[str, dict[str, Any]]] = [
    ("/api/config/live", {"fields": {"junk_filter": "1"}}),
    ("/api/volume", {"level": "-20"}),
    ("/api/livepresets/warm/apply", {}),
    ("/api/matrix/profile", {"action": "switch", "name": ""}),
    ("/api/autopilot", {"enabled": True}),
    ("/api/config/apply", {}),
]

#: The codes a not-ready app refuses under, one per cause.
REFUSAL_CODES = {"no_http_client", "no_credentials", "daemon_unavailable", "daemon_read_failed"}


def _not_ready(client: TestClient) -> bool:
    return not client.get("/api/health").json()["ready"]


def _config_page_down(lanes: Lanes) -> None:
    lanes.http["_take_lane_down"]()


def _credentials_refused(lanes: Lanes) -> None:
    lanes.http["_refuse_auth"] = True


def _config_page_unread(lanes: Lanes) -> None:
    lanes.http["_fail_paths"] = ["/config"]


CAUSES: list[Any] = [
    pytest.param(_config_page_down, id="8088-down"),
    pytest.param(_credentials_refused, id="credentials-refused"),
    pytest.param(_config_page_unread, id="config-unread"),
]


def take_away(lanes: Lanes, cause: Callable[[Lanes], None]) -> Lanes:
    """Move one lane as ``cause`` says and return once a poll has recorded it."""
    cause(lanes)
    wait_for_api(lanes.client, _not_ready)
    return lanes


@pytest.mark.parametrize("cause", CAUSES)
@pytest.mark.parametrize(("path", "body"), ENGINE_WRITES)
def test_an_engine_write_is_refused_while_a_lane_is_down(
    lanes: Lanes, cause: Callable[[Lanes], None], path: str, body: dict[str, Any]
) -> None:
    take_away(lanes, cause)
    assert lanes.post(path, body).json().get("code") in REFUSAL_CODES


def commands_sent_by_all(lanes: Lanes) -> int:
    """How many commands the 4321 fake logged while the six engine writes ran in turn, an edit staged for the apply."""
    lanes.post("/api/config/stage", {"live": {"shaper": {"value": "5"}}})
    return sum(lanes.commands_sent_by(path, body) for path, body in ENGINE_WRITES)


@pytest.mark.parametrize("cause", CAUSES)
def test_the_engine_writes_send_the_4321_daemon_fewer_commands_while_a_lane_is_down_than_while_both_stand(
    lanes: Lanes, cause: Callable[[Lanes], None]
) -> None:
    both_standing = commands_sent_by_all(lanes)
    take_away(lanes, cause)
    assert commands_sent_by_all(lanes) < both_standing


def test_a_write_that_needs_no_control_lane_is_refused_while_hqptuners_own_apply_has_the_daemon_restarting(
    lanes: Lanes,
) -> None:
    # An apply drops the control lane and the daemon is away for a window; auto-pilot's switch asks the engine nothing,
    # so only the gate can refuse it. The daemon refusing reconnects holds the window open on the virtual clock.
    lanes.control["_refuse_connects"] = "1000"
    portal = lanes.client.portal
    if portal is None:
        raise FixtureError(reason="the app's portal is not open")
    portal.call(app_manager(lanes.client).restarting)
    assert lanes.post("/api/autopilot", {"enabled": True}).json().get("code") in REFUSAL_CODES
