"""The connect body and the heartbeat, as the daemon's standing sees them.

The loop dials, handshakes, fills the readings and
polls, and every move of the phase is the wire fact behind it. Each case runs ``loader.run`` on a virtual clock against
the Control API fake and the 8088 fake, moves one of them from the test's side of the wire, lets poll intervals pass,
and reads the phase, the generation or the readings that come back.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import READY_CEILING, advanced, settled
from conftest import DaemonFactory
from fake_control import restart_into, take_lane_down
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core import loader
from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.readings import Source, Stamp

#: The manager's poll interval: every window below is counted in these.
POLL = 2.0
#: The window, three polls long, so a lane gone for good turns Alarm inside a handful of passes.
WINDOW = 3 * POLL
#: Passes a recovering daemon is given to come back; reached only when it never does.
RECOVERY_PASSES = 20
#: Passes let run with the control lane gone for good: well past the window.
GONE_PASSES = 6

#: The 8088 lane's behaviors, as the fake's state knobs: answering every page, answering every page 503, and
#: answering every page with the credential refusal.
ANSWERING = "answering"
UNAVAILABLE = "unavailable"
REFUSING = "refusing"
#: No listener at the 8088 port at all: every dial to it is refused.
UNLISTENED = "unlistened"
LANE_KNOBS: dict[str, dict[str, object]] = {
    ANSWERING: {},
    UNAVAILABLE: {"_down": True},
    REFUSING: {"_refuse_auth": True},
    UNLISTENED: {},
}

#: The output mode the fake restarts into, and the mode index its State reports for it afterwards.
RESTARTED_MODE = "sdm"
RESTARTED_MODE_INDEX = "2"
#: The dither and modulator enum IDs the restarted instance boots on.
RESTARTED_DITHER = "0"
RESTARTED_MODULATOR = "0"

#: The chain the engine runs before a foreign chain switch, and the one its State reports after it, each a
#: State field to its list index on the chain's own lists.
CHAIN_BEFORE = {"mode": "1", "filterNx": "2", "filter1x": "2", "shaper": "1"}
CHAIN_AFTER = {"mode": "2", "filterNx": "1", "filter1x": "1", "shaper": "0"}


@dataclass
class Rig:
    """A loop running against both fakes: its manager, the control fake's live State, and the 8088 fake's state."""

    manager: ConnectionManager
    engine: dict[str, str]
    lane: dict[str, Any]


Build = Callable[..., Awaitable[Rig]]


@pytest.fixture
async def rig(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path, closed_port: int) -> AsyncIterator[Build]:
    """Start ``loader.run`` on a manager over both fakes, handed over once the loop idles on the clock.

    ``lane`` is one of the 8088 behaviors above; keyword arguments are the control fake's State overrides.
    """
    running: list[tuple[asyncio.Event, asyncio.Task[None], ConnectionManager, HttpConfigClient]] = []
    served: list[Iterator[dict[str, Any]]] = []

    async def build(lane: str = ANSWERING, **engine: str) -> Rig:
        port, _log, state = await daemon(**engine)
        spawned = fake_http.spawn(fake_http.state(**LANE_KNOBS[lane]))
        served.append(spawned)
        http_state = next(spawned)
        http_port = closed_port if lane == UNLISTENED else int(http_state["_port"])
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            poll_interval=POLL,
            alarm_threshold=WINDOW,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        )
        manager = ConnectionManager(cfg, http, clock=clock)
        stop = asyncio.Event()
        task = clock.spawn(loader.run(manager, stop))
        running.append((stop, task, manager, http))
        await settled(clock)
        return Rig(manager, state, http_state)

    yield build
    for stop, task, manager, http in running:
        stop.set()
        await asyncio.wait_for(task, READY_CEILING)
        await manager.aclose()
        await http.aclose()
    for spawned in served:
        next(spawned, None)


async def _passes_until(clock: VirtualClock, done: Callable[[], bool], limit: int) -> int:
    """Let poll intervals pass one at a time until ``done`` holds or ``limit`` have passed; the count that passed."""
    for passes in range(limit):
        if done():
            return passes
        await advanced(clock, POLL)
    return limit


def _back_ready_after_a_departure(manager: ConnectionManager) -> Callable[[], bool]:
    """Whether the manager stands Ready again on a connection made after at least one proven departure."""

    def done() -> bool:
        standing = manager.phase.standing
        return standing.phase is Phase.READY and standing.generation > 0

    return done


async def _restarted(rig: Rig, clock: VirtualClock, window: int = 1) -> None:
    """Restart the control fake into another mode, turning ``window`` dials away, and let the loop come back Ready."""
    rig.engine["_restart_window"] = str(window)
    restart_into(rig.engine, RESTARTED_MODE, RESTARTED_DITHER, RESTARTED_MODULATOR)
    await _passes_until(clock, _back_ready_after_a_departure(rig.manager), RECOVERY_PASSES)


# --- Reachable and Ready: the handshake and the configuration lane's answer ---------------------------------------


@pytest.mark.parametrize(
    ("lane", "phase"),
    [
        (ANSWERING, Phase.READY),
        (UNAVAILABLE, Phase.REACHABLE),
        (UNLISTENED, Phase.REACHABLE),
        (REFUSING, Phase.REACHABLE),
    ],
    ids=["form_answered", "form_unavailable", "no_listener", "credentials_refused"],
)
async def test_the_daemon_is_ready_only_once_the_configuration_lane_answers_its_form(
    rig: Build, lane: str, phase: Phase
) -> None:
    built = await rig(lane)
    assert built.manager.phase.standing.phase is phase


async def test_a_daemon_whose_configuration_lane_never_answers_stays_reachable_past_the_window(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(UNAVAILABLE)
    await _passes_until(clock, lambda: False, GONE_PASSES)
    assert built.manager.phase.standing.phase is Phase.REACHABLE


async def test_a_configuration_lane_that_starts_answering_makes_the_daemon_ready_on_the_next_poll(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(UNAVAILABLE)
    built.lane["_down"] = False
    await advanced(clock, POLL)
    assert built.manager.phase.standing.phase is Phase.READY


async def test_a_form_that_stops_answering_on_a_poll_drops_a_ready_daemon_to_reachable(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(ANSWERING)
    built.lane["_down"] = True
    await advanced(clock, POLL)
    assert built.manager.phase.standing.phase is Phase.REACHABLE


async def test_a_form_that_stops_answering_on_a_poll_leaves_the_generation_where_the_last_departure_put_it(
    rig: Build, clock: VirtualClock
) -> None:
    # one restart first, so the generation the form failure must leave alone is one no fresh manager stands at
    built = await rig(ANSWERING)
    await _restarted(built, clock)
    built.lane["_down"] = True
    await advanced(clock, POLL)
    assert built.manager.phase.standing.generation == 1


# --- departures: the generation and the window ---------------------------------------------------------------------


@pytest.mark.parametrize("window", [1, 4], ids=["one_dial_turned_away", "four_dials_turned_away"])
async def test_a_restart_advances_the_generation_once_however_many_dials_it_turns_away(
    rig: Build, clock: VirtualClock, window: int
) -> None:
    built = await rig(ANSWERING)
    await _restarted(built, clock, window)
    assert built.manager.phase.standing.generation == 1


async def test_a_control_lane_gone_for_good_advances_the_generation_once_however_many_dials_are_refused(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(ANSWERING)
    take_lane_down(built.engine)
    await _passes_until(clock, lambda: False, GONE_PASSES)
    assert built.manager.phase.standing.generation == 1


async def test_a_control_lane_gone_for_good_turns_alarm_once_the_window_has_run(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(ANSWERING)
    take_lane_down(built.engine)
    await _passes_until(clock, lambda: False, GONE_PASSES)
    assert built.manager.phase.standing.phase is Phase.ALARM


# --- the readings belong to the connection they were read on --------------------------------------------------------


async def test_the_readings_after_a_restart_are_the_restarted_instances(rig: Build, clock: VirtualClock) -> None:
    built = await rig(ANSWERING)
    await _restarted(built, clock)
    state = built.manager.readings.state
    assert state is not None
    assert state["mode"] == RESTARTED_MODE_INDEX


async def test_the_readings_after_a_restart_are_stamped_with_the_generation_it_advanced_to(
    rig: Build, clock: VirtualClock
) -> None:
    built = await rig(ANSWERING)
    await _restarted(built, clock)
    assert built.manager.readings.engine_stamp == Stamp(source=Source.ENGINE, generation=1)


@pytest.mark.parametrize("field", ["filterNx", "shaper"])
async def test_a_foreign_chain_switch_leaves_the_engines_own_chain_in_the_readings(
    rig: Build, clock: VirtualClock, field: str
) -> None:
    built = await rig(ANSWERING, **CHAIN_BEFORE)
    built.engine.update(CHAIN_AFTER)
    await advanced(clock, 2 * POLL)
    state = built.manager.readings.state
    assert state is not None
    assert state[field] == CHAIN_AFTER[field]


# --- the credential verdict rides the readings ----------------------------------------------------------------------


@pytest.mark.parametrize(("lane", "verdict"), [(ANSWERING, True), (REFUSING, False)], ids=["accepted", "refused"])
async def test_credentials_ok_is_the_configuration_lanes_verdict_on_the_credentials(
    rig: Build, lane: str, *, verdict: bool
) -> None:
    built = await rig(lane)
    assert built.manager.readings.credentials_ok is verdict


async def test_a_credential_refusal_on_a_poll_leaves_a_ready_daemon_ready(rig: Build, clock: VirtualClock) -> None:
    built = await rig(ANSWERING)
    built.lane["_refuse_auth"] = True
    await advanced(clock, POLL)
    assert built.manager.phase.standing.phase is Phase.READY
