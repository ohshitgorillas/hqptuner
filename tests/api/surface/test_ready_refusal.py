"""The refusal a not-ready app answers names the cause the user can act on (docs/testing.md).

Each case runs a manager on both fake daemons, ready, and moves one lane mid-run; the refusal is read from the manager
the way the gate reads it. ``detail`` is copy and is never asserted (rule 9).
"""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from apps import advanced, blank_the_managers_pair, settled
from conftest import HttpLanes, LiveManager
from fake_control import take_lane_down
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.readygate import refusal
from hqptuner.core.manager import ConnectionManager

#: A bound on the poll passes a move may take to show, so a move that never lands is a loud failure.
POLLS = 20


class Rig:
    """What a case moves: the manager, its clock, each fake daemon's state and where the connection record lands."""

    def __init__(
        self,
        manager: ConnectionManager,
        clock: VirtualClock,
        control: dict[str, str],
        http: dict[str, Any],
        record: Path,
    ) -> None:
        self.manager = manager
        self.clock = clock
        self.control = control
        self.http = http
        self.record = record

    async def poll_until(self, reached: Callable[[ConnectionManager], bool]) -> None:
        """Advance the clock one poll interval at a time until ``reached`` holds for the manager."""
        for _ in range(POLLS):
            if reached(self.manager):
                return
            await advanced(self.clock, self.manager.cfg.poll_interval)
        raise FixtureError(reason="the move never showed on the manager")


async def _no_client(rig: Rig) -> None:
    await blank_the_managers_pair(rig.manager, rig.clock, rig.record)


async def _credentials_refused(rig: Rig) -> None:
    rig.http["_refuse_auth"] = True
    await rig.poll_until(lambda m: m.readings.credentials_ok is False)


async def _control_down(rig: Rig) -> None:
    take_lane_down(rig.control)
    await rig.poll_until(lambda m: not m.connected.is_set())


async def _config_unread(rig: Rig) -> None:
    rig.http["_fail_paths"] = ["/config"]
    await rig.poll_until(lambda m: m.readings.config_error is not None)


async def _refused_then_control_down(rig: Rig) -> None:
    await _credentials_refused(rig)
    await _control_down(rig)


CAUSES = [
    pytest.param(_no_client, "no_http_client", id="no-client"),
    pytest.param(_credentials_refused, "no_credentials", id="credentials-refused"),
    pytest.param(_control_down, "daemon_unavailable", id="control-down"),
    pytest.param(_config_unread, "daemon_read_failed", id="config-unread"),
    # The user's fix is named before a symptom: a refused pair outranks a control lane that is also down.
    pytest.param(_refused_then_control_down, "no_credentials", id="credentials-outrank-control-down"),
]


@pytest.mark.parametrize(("move", "code"), CAUSES)
async def test_a_not_ready_app_refuses_under_the_code_of_its_cause(
    live_manager: LiveManager,
    http_lanes: HttpLanes,
    clock: VirtualClock,
    tmp_path: Path,
    move: Callable[[Rig], Awaitable[None]],
    code: str,
) -> None:
    manager, _log, control = await live_manager()
    await settled(clock)
    await move(Rig(manager, clock, control, http_lanes[manager], tmp_path / "connection.json"))
    assert refusal(manager).code == code
