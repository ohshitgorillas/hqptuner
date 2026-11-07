"""Readings taken on a connection die with it, even when the connection ends while the connect body is still filling.

The connect body reads the Engine on a fresh control connection and awaits the configuration lane. When HQPTuner takes
that connection down while the body still awaits the lane, what the body read on it is no Engine reading once the lane
answers: the Engine view stays empty until a later connection reads its own.

Each case runs ``ConnectionManager.run`` on a virtual clock against the Control API fake and two 8088 fakes: the
stock one behind the manager's configuration client, and one at the configured 8088 port that holds the first
``/about`` release lookup until the test releases it. A manager whose connection stood through the held lookup is
read beside one whose connection was taken down during it, the control lane then refusing every dial, so no later
connection reads anything.
"""

import asyncio
import threading
from asyncio import FIRST_COMPLETED
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import READY_CEILING, advanced, settled
from conftest import DaemonFactory
from fake_control import take_lane_down
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.readings import Source, Stamp

#: The manager's poll interval.
POLL = 2.0
#: The window, long enough that the passes below never reach Alarm.
WINDOW = 10 * POLL
#: Poll passes given for the held lookup to reach the wire; reached only when the fixture is broken.
ARRIVAL_PASSES = 10
#: Poll passes let run after the held lookup is released: room for the connect body to finish and the loop to dial.
PASSES_AFTER_RELEASE = 3

#: The 8088 request held: the release lookup the connect body awaits on the configuration lane.
HELD_PATH = "/about"
#: The about page served once the lookup is released: the release under the Version heading, on its own line.
ABOUT_PAGE = b"<html><body>\n<h3>Version</h3>\n6.0.2\n</body></html>"
HTTP_OK = 200
HTTP_NOT_FOUND = 404

#: Why HQPTuner takes the control connection down.
TAKEN_DOWN_FOR = "a restart was requested"

#: The stamp an Engine reading taken on a fresh manager's first connection carries: no departure proven yet.
READ_ON_THE_FIRST_CONNECTION = Stamp(source=Source.ENGINE, generation=0)


@dataclass
class Lookup:
    """The held release lookup: ``arrived`` once it reaches the wire, answered once ``released`` is set."""

    arrived: threading.Event
    released: threading.Event


def _holding_about(lookup: Lookup) -> type[BaseHTTPRequestHandler]:
    """An 8088 handler that holds the first ``HELD_PATH`` request until ``lookup.released``, then serves the page."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != HELD_PATH:
                self.send_response(HTTP_NOT_FOUND)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if not lookup.arrived.is_set():
                lookup.arrived.set()
                lookup.released.wait(READY_CEILING)
            self.send_response(HTTP_OK)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(ABOUT_PAGE)))
            self.end_headers()
            self.wfile.write(ABOUT_PAGE)

        def log_message(self, *_: object) -> None:
            pass

    return Handler


@dataclass
class Held:
    """A running manager whose connect body awaits the held lookup, the lookup, and the control fake's live State."""

    manager: ConnectionManager
    lookup: Lookup
    engine: dict[str, str]


Begin = Callable[[], Awaitable[Held]]


@pytest.fixture
async def begin(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path) -> AsyncIterator[Begin]:
    """Spawn ``run`` on a manager over the fakes, handed over once the held lookup has reached the 8088 wire."""
    running: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []
    served: list[Iterator[dict[str, Any]]] = []
    lookups: list[Lookup] = []

    async def start() -> Held:
        port, _commands, engine = await daemon()
        stock = fake_http.spawn(fake_http.state())
        served.append(stock)
        lane = next(stock)
        lookup = Lookup(threading.Event(), threading.Event())
        lookups.append(lookup)
        holding = fake_http.spawn({}, handler=_holding_about(lookup))
        served.append(holding)
        about = next(holding)
        http = HttpConfigClient("127.0.0.1", int(lane["_port"]), "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            hqp_http_port=int(about["_port"]),
            poll_interval=POLL,
            alarm_threshold=WINDOW,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        )
        manager = ConnectionManager(cfg, http, clock=clock)
        task = clock.spawn(manager.run())
        running.append((manager, task, http))
        await _until_held(clock, lookup)
        return Held(manager, lookup, engine)

    yield start
    for lookup in lookups:
        lookup.released.set()
    for manager, task, http in running:
        manager.stop()
        await asyncio.wait_for(task, READY_CEILING)
        await manager.aclose()
        await http.aclose()
    for spawned in served:
        next(spawned, None)


async def _until_held(clock: VirtualClock, lookup: Lookup) -> None:
    """Let poll passes run until the held lookup reaches the wire; a loop that never sends it is a broken fixture.

    A pass that ends with the lookup held never returns, since the task awaiting it is not waiting on the clock, so
    each pass races the arrival.
    """
    arrival = asyncio.ensure_future(asyncio.to_thread(lookup.arrived.wait, READY_CEILING))
    for _ in range(ARRIVAL_PASSES):
        step = asyncio.ensure_future(clock.advance(POLL))
        done, _pending = await asyncio.wait({arrival, step}, timeout=READY_CEILING, return_when=FIRST_COMPLETED)
        if arrival in done:
            step.cancel()
            return
    raise FixtureError(reason=f"no {HELD_PATH} request reached the 8088 wire")


async def _released(held: Held, clock: VirtualClock) -> None:
    """Let the held lookup through, and let the loop run on for a few poll passes."""
    held.lookup.released.set()
    await settled(clock)
    for _ in range(PASSES_AFTER_RELEASE):
        await advanced(clock, POLL)


def _engine_reading(manager: ConnectionManager) -> Stamp | None:
    """The stamp of the Engine reading the manager holds, or None where it holds none."""
    snapshot = manager.readings.engine_snapshot()
    return None if snapshot is None else snapshot.stamp


async def test_readings_taken_on_a_connection_taken_down_while_the_connect_body_awaits_the_lane_are_not_kept(
    begin: Begin, clock: VirtualClock
) -> None:
    calm = await begin()
    await _released(calm, clock)
    taken = await begin()
    await taken.manager.take_control_down(TAKEN_DOWN_FOR)
    take_lane_down(taken.engine)
    await _released(taken, clock)
    assert (_engine_reading(calm.manager), _engine_reading(taken.manager)) == (READ_ON_THE_FIRST_CONNECTION, None)
