"""The manager's run and stop, as the daemon and the clock see them.

``ConnectionManager.run`` keeps the daemon connected until ``stop``: it drives the connect loop, enters it again after
its retry delay whenever a fault ends it, and ``stop`` ends it without waiting out any interval. Each case runs the
manager on a virtual clock against the Control API fake, and, where a case needs a fault, an 8088 client whose
transport raises one, and reads the phase, the commands the daemon received, or the clock reading at which ``run``
ended.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from apps import READY_CEILING, advanced, settled
from conftest import DaemonFactory
from fake_control import CommandLog
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager, reconnect_delay

#: The manager's poll interval.
POLL = 2.0
#: The window: production-sized, and long enough for a fault's retry to land inside it.
WINDOW = 4.0
#: Passes given to a manager whose daemon dropped it to stand connected again.
RECOVERY_SPAN = 3 * POLL


@dataclass
class Running:
    """A manager whose ``run`` is under way: the daemon's live State and received commands, and when ``run`` ended."""

    manager: ConnectionManager
    engine: dict[str, str]
    commands: CommandLog
    ended: list[float]


Start = Callable[..., Awaitable[Running]]


class _UnhandledFaultError(Exception):
    """A fault no handler inside the connect loop names, so it ends the loop and reaches ``run``."""


def _raise_unhandled(request: httpx.Request) -> httpx.Response:
    """The 8088 wire under a faulting client: every request it is sent raises the unhandled fault."""
    raise _UnhandledFaultError(request.url.path)


@pytest.fixture
async def start(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path) -> AsyncIterator[Start]:
    """Spawn ``run`` on a manager over the Control API fake, handed over once it idles on the clock.

    With ``faulting`` the manager also holds an 8088 client whose transport raises a fault the connect loop does not
    handle, which ends every pass of the connect loop right after the daemon answered.
    """
    running: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient | None]] = []

    async def begin(*, faulting: bool = False) -> Running:
        port, commands, engine = await daemon()
        http: HttpConfigClient | None = None
        if faulting:
            transport = httpx.MockTransport(_raise_unhandled)
            http = HttpConfigClient("hqplayer.invalid", 8088, "u", "p", HttpOptions(transport=transport))
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            poll_interval=POLL,
            alarm_threshold=WINDOW,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        )
        manager = ConnectionManager(cfg, http, clock=clock)
        ended: list[float] = []
        task = clock.spawn(manager.run())
        task.add_done_callback(lambda _: ended.append(clock.monotonic()))
        running.append((manager, task, http))
        await settled(clock)
        return Running(manager, engine, commands, ended)

    yield begin
    for manager, task, http in running:
        manager.stop()
        await asyncio.wait_for(task, READY_CEILING)
        await manager.aclose()
        if http is not None:
            await http.aclose()


def _dials(commands: CommandLog) -> int:
    """How many connections the daemon handshook: one ``GetInfo`` opens each."""
    return sum(1 for name, _ in commands if name == "GetInfo")


async def _stopped_at(running: Running, clock: VirtualClock) -> float:
    """Let a poll interval pass, call ``stop``, and answer the clock reading at that call."""
    await advanced(clock, POLL)
    at = clock.monotonic()
    running.manager.stop()
    await settled(clock)
    return at


async def test_a_running_manager_stands_connected_again_after_the_daemon_drops_it(
    start: Start, clock: VirtualClock
) -> None:
    running = await start()
    running.engine["_generation"] = "1"
    await advanced(clock, RECOVERY_SPAN)
    standing = running.manager.phase.standing
    assert (standing.phase, standing.generation) == (Phase.REACHABLE, 1)


async def test_a_fault_that_ends_the_connect_loop_does_not_end_the_manager(start: Start, clock: VirtualClock) -> None:
    running = await start(faulting=True)
    before = _dials(running.commands)
    await advanced(clock, WINDOW)
    assert _dials(running.commands) > before


async def test_stop_ends_a_connected_manager_without_waiting_out_an_interval(start: Start, clock: VirtualClock) -> None:
    running = await start()
    at = await _stopped_at(running, clock)
    assert running.ended == [at]


async def test_stop_ends_the_manager_inside_its_retry_delay_without_waiting_it_out(
    start: Start, clock: VirtualClock
) -> None:
    running = await start(faulting=True)
    at = await _stopped_at(running, clock)
    assert running.ended == [at]


@pytest.mark.parametrize("inside", [Phase.DOWN, Phase.REACHABLE, Phase.READY])
def test_the_retry_delay_once_in_alarm_is_longer_than_inside_the_window(inside: Phase) -> None:
    assert reconnect_delay(Phase.ALARM) > reconnect_delay(inside)
