"""A daemon whose configuration lane answers ``/backup`` on connect with bytes that are no settings archive.

Reachable moves to Ready only once the configuration lane's read has
answered on this connection, and an unreadable archive is not that answer. The control connection stands meanwhile.
Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake and an 8088 fake whose backup
archive is an error page, lets poll intervals pass, and reads the phase or the handshakes the daemon received.
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
from fake_control import CommandLog
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager

#: The manager's poll interval: every span below is counted in these.
POLL = 2.0
#: The window, long enough that no span below reaches it, so Alarm never stands in for Down.
WINDOW = 20 * POLL
#: Polls let pass after the connect before the manager is read: enough for any redial to have happened.
SPAN = 3 * POLL


@dataclass
class Rig:
    """A running manager over an 8088 fake serving an unreadable backup, and the control fake's received commands."""

    manager: ConnectionManager
    commands: CommandLog


Start = Callable[[], Awaitable[Rig]]


@pytest.fixture
async def start(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path) -> AsyncIterator[Start]:
    """Spawn ``run`` on a manager holding an 8088 client on a fake whose backup archive is an error page.

    Handed over once the manager idles on the clock after its first connect.
    """
    running: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []
    served: list[Iterator[dict[str, Any]]] = []

    async def begin() -> Rig:
        port, commands, _engine = await daemon()
        spawned = fake_http.spawn(fake_http.state(_corrupt_backup=True))
        served.append(spawned)
        http_port = int(next(spawned)["_port"])
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            hqp_http_port=http_port,
            poll_interval=POLL,
            alarm_threshold=WINDOW,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        )
        manager = ConnectionManager(cfg, http, clock=clock)
        task = clock.spawn(manager.run())
        running.append((manager, task, http))
        await settled(clock)
        return Rig(manager, commands)

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


async def test_an_unreadable_backup_on_connect_leaves_the_daemon_standing_reachable(
    start: Start, clock: VirtualClock
) -> None:
    rig = await start()
    await advanced(clock, SPAN)
    assert rig.manager.phase.standing.phase is Phase.REACHABLE


async def test_an_unreadable_backup_on_connect_keeps_the_control_connection_it_arrived_on(
    start: Start, clock: VirtualClock
) -> None:
    rig = await start()
    await advanced(clock, SPAN)
    assert _handshakes(rig.commands) == 1
