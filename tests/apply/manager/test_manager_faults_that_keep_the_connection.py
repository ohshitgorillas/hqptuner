"""Answers and faults that are no departure.

A ``result="Error"`` reply is a complete, correctly paired answer, so a connect or heartbeat read that gets one keeps
the control connection: no Down, no departure, no redial. A fault on the configuration lane while the control socket
stands is not a departure either: a Ready daemon steps back to Reachable on the control connection it already holds.
A frame on the control socket that will not parse makes HQPTuner close that socket itself: a taken Down at the
generation it stood at, which the dial that follows moves on from.

Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake and the 8088 fake, the 8088
client riding a transport that, once armed, raises one transport fault on every request, lets poll intervals pass, and
reads the phase, the generation or the handshakes the daemon answered.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fake_http
import httpx
import pytest
from apps import READY_CEILING, advanced, settled
from conftest import DaemonFactory
from fake_control import CommandLog
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager

#: The manager's poll interval.
POLL = 2.0
#: The window, long enough that nothing the cases do turns Alarm.
WINDOW = 20 * POLL
#: Poll intervals let pass after the error or the fault, enough for a dropped connection to be redialed.
OBSERVED_SPAN = 4 * POLL

#: Every read the Control API answers except the ``GetInfo`` handshake, each refused with ``result="Error"`` once the
#: daemon is told to: whatever a connect or a heartbeat reads, it gets the refusal.
REFUSED_READS = " ".join(
    [
        "State",
        "Status",
        "GetLicense",
        "GetModes",
        "GetFilters",
        "GetShapers",
        "GetRates",
        "GetJunkFilters",
        "VolumeRange",
        "MatrixListProfiles",
        "MatrixGetProfile",
        "ConfigurationGet",
    ]
)

#: The heartbeat read the daemon answers once with a whole frame that is not XML.
UNPARSED_READ = "Status"

#: When the daemon starts refusing: from the first connect, or on a heartbeat after the connection stood Ready.
AT_CONNECT = "connect"
AT_HEARTBEAT = "heartbeat"

#: The phases in which a control connection stands.
STANDING = frozenset({Phase.REACHABLE, Phase.READY})

#: Transport faults on the configuration lane: refused, timed out, reset, and a reply that will not parse.
LANE_FAULTS = [httpx.ConnectError, httpx.ReadTimeout, httpx.ReadError, httpx.RemoteProtocolError]
LANE_FAULT_IDS = ["refused", "timed_out", "reset", "unparseable"]


class _FaultingTransport(httpx.AsyncBaseTransport):
    """The 8088 wire: the fake's own answers until ``fault`` is set, then that fault on every request."""

    def __init__(self) -> None:
        self.inner = httpx.AsyncHTTPTransport()
        self.fault: type[httpx.TransportError] | None = None

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if self.fault is not None:
            raise self.fault(request.url.path, request=request)
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()


@dataclass
class Running:
    """A running manager, the control fake's live State and received commands, and the 8088 wire under it."""

    manager: ConnectionManager
    engine: dict[str, str]
    commands: CommandLog
    wire: _FaultingTransport


Start = Callable[..., Awaitable[Running]]


@pytest.fixture
async def start(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path) -> AsyncIterator[Start]:
    """Spawn ``run`` on a manager over both fakes, the 8088 fake answering its form, handed over once it idles on the
    clock; keyword arguments are the control fake's State overrides."""
    running: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []
    served: list[Iterator[dict[str, Any]]] = []

    async def begin(**engine_overrides: str) -> Running:
        port, commands, engine = await daemon(**engine_overrides)
        spawned = fake_http.spawn(fake_http.state())
        served.append(spawned)
        lane = next(spawned)
        wire = _FaultingTransport()
        http = HttpConfigClient("127.0.0.1", int(lane["_port"]), "u", "p", HttpOptions(transport=wire))
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            poll_interval=POLL,
            alarm_threshold=WINDOW,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        )
        manager = ConnectionManager(cfg, http, clock=clock)
        task = clock.spawn(manager.run())
        running.append((manager, task, http))
        await settled(clock)
        return Running(manager, engine, commands, wire)

    yield begin
    for manager, task, http in running:
        manager.stop()
        await asyncio.wait_for(task, READY_CEILING)
        await manager.aclose()
        await http.aclose()
    for spawned in served:
        next(spawned, None)


def _handshakes(commands: CommandLog) -> int:
    """How many control connections the daemon handshook: one ``GetInfo`` opens each."""
    return sum(1 for name, _ in commands if name == "GetInfo")


async def _ready(start: Start) -> Running:
    """A running manager standing Ready on a daemon that refuses nothing; one that does not is a broken fixture."""
    running = await start()
    if running.manager.phase.standing.phase is not Phase.READY:
        raise FixtureError(reason=f"the manager stands {running.manager.phase.standing.phase}, not Ready")
    return running


async def _refusing(start: Start, clock: VirtualClock, when: str) -> Running:
    """A running manager on a daemon refusing every read: from the first connect, or from a heartbeat on a connection
    that already stood Ready. Either way the observed span has passed since the first refusal could land."""
    if when == AT_CONNECT:
        running = await start(_error=REFUSED_READS)
    else:
        running = await _ready(start)
        running.engine["_error"] = REFUSED_READS
    await advanced(clock, OBSERVED_SPAN)
    return running


async def _lane_faulted(start: Start, clock: VirtualClock, fault: type[httpx.TransportError]) -> Running:
    """A manager that stood Ready, after the observed span with the configuration lane raising ``fault``."""
    running = await _ready(start)
    running.wire.fault = fault
    await advanced(clock, OBSERVED_SPAN)
    return running


# --- an Error reply on the control socket ---------------------------------------------------------------------------


async def test_an_error_reply_to_a_connect_read_leaves_the_control_connection_standing(
    start: Start, clock: VirtualClock
) -> None:
    running = await _refusing(start, clock, AT_CONNECT)
    assert running.manager.phase.standing.phase in STANDING


async def test_an_error_reply_to_a_heartbeat_read_leaves_a_ready_daemon_ready(
    start: Start, clock: VirtualClock
) -> None:
    running = await _refusing(start, clock, AT_HEARTBEAT)
    assert running.manager.phase.standing.phase is Phase.READY


@pytest.mark.parametrize("when", [AT_CONNECT, AT_HEARTBEAT])
async def test_an_error_reply_keeps_the_control_socket_it_came_on(start: Start, clock: VirtualClock, when: str) -> None:
    running = await _refusing(start, clock, when)
    assert _handshakes(running.commands) == 1


# --- a frame that will not parse on the control socket --------------------------------------------------------------


async def _answered_once_with_a_frame_that_is_not_xml(start: Start, clock: VirtualClock) -> tuple[Running, int]:
    """A manager that stood Ready at the generation returned, after the observed span from a heartbeat whose
    ``Status`` read the daemon answered once with a whole frame that is not XML."""
    running = await _ready(start)
    before = running.manager.phase.standing.generation
    running.engine["_not_xml"] = UNPARSED_READ
    await advanced(clock, OBSERVED_SPAN)
    return running, before


async def test_a_heartbeat_frame_that_is_not_xml_is_no_departure_and_leaves_the_generation_unchanged(
    start: Start, clock: VirtualClock
) -> None:
    running, before = await _answered_once_with_a_frame_that_is_not_xml(start, clock)
    assert running.manager.phase.standing.generation == before


async def test_a_heartbeat_frame_that_is_not_xml_closes_the_control_socket_and_the_next_dial_handshakes_anew(
    start: Start, clock: VirtualClock
) -> None:
    running, _before = await _answered_once_with_a_frame_that_is_not_xml(start, clock)
    assert _handshakes(running.commands) == 2


# --- a fault on the configuration lane ------------------------------------------------------------------------------


@pytest.mark.parametrize("fault", LANE_FAULTS, ids=LANE_FAULT_IDS)
async def test_a_configuration_lane_fault_on_a_poll_steps_a_ready_daemon_back_to_reachable(
    start: Start, clock: VirtualClock, fault: type[httpx.TransportError]
) -> None:
    running = await _lane_faulted(start, clock, fault)
    assert running.manager.phase.standing.phase is Phase.REACHABLE


@pytest.mark.parametrize("fault", LANE_FAULTS, ids=LANE_FAULT_IDS)
async def test_a_configuration_lane_fault_on_a_poll_keeps_the_control_socket(
    start: Start, clock: VirtualClock, fault: type[httpx.TransportError]
) -> None:
    running = await _lane_faulted(start, clock, fault)
    assert _handshakes(running.commands) == 1
