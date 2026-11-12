"""A 401 that follows a normal answer in the same apply is the daemon restarting, not a rejected password.

The 8088 fake serves the first backup and the restore, then refuses every request: what a daemon coming back up with
its authentication not yet answering looks like from the lane. The poll is parked, so the apply's own requests are the
only traffic on the lane.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import advance_app, app_manager
from fixtures_clients import Lanes, serve_lanes

_PARKED = 30.0


@pytest.fixture
def refused_after_restore(tmp_path: Path) -> Iterator[Lanes]:
    """Both lanes standing, the poll parked, and the 8088 fake set to refuse every request once it adopts a restore."""
    yield from serve_lanes(tmp_path, poll_interval=_PARKED)


def _apply(lanes: Lanes) -> dict[str, str]:
    lanes.http["_on_restore"] = lambda: lanes.http.update(_refuse_auth=True)
    lanes.post("/api/config/stage", {"http": {"title": "Renamed"}})
    answer: dict[str, str] = lanes.post("/api/config/apply", {}).json()
    return answer


def test_a_401_after_a_restore_answered_is_an_engine_fault(refused_after_restore: Lanes) -> None:
    assert _apply(refused_after_restore).get("code") == "daemon_write_failed"


def test_a_401_after_a_restore_answered_leaves_the_credentials_accepted(refused_after_restore: Lanes) -> None:
    _apply(refused_after_restore)
    assert app_manager(refused_after_restore.client).readings.credentials_ok is True


def test_the_restarting_daemons_next_poll_cannot_turn_it_into_a_refusal(refused_after_restore: Lanes) -> None:
    _apply(refused_after_restore)
    refused_after_restore.http["_take_lane_down"]()
    advance_app(refused_after_restore.client, _PARKED)
    assert app_manager(refused_after_restore.client).readings.credentials_ok is True
