"""Fixture plugin (registered from conftest.py): fake daemons themselves.

The Control API fakes served in the test's own event loop, their pre-baked
variants (split filter slots, garbled metadata, disabled volume), the threaded
ports built on conftest's `spawn_threaded_daemon`, the port-8088 HTTP config
fakes from `fake_http`, the fake 4322 metering streams, and the rig that runs a
manager over a Control API fake and an 8088 fake."""

import asyncio
import contextlib
import functools
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import fake_http
import httpx
import pytest
from apps import READY_CEILING
from conftest import DaemonFactory, spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog, serve, serve_shared
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteResult, apply_live

#: The client's per-command deadline, in real seconds, against a fake that answers every command at once.
REPLY_TIMEOUT = 2.0


@pytest.fixture
async def live_daemon_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def daemon() -> AsyncIterator[DaemonFactory]:
    """Fake daemons on demand, each with its own recorded traffic and its own
    State. Keyword arguments are the State overrides the fixtures above bake in
    one apiece: ``daemon(rate="2", _deaf="SetMode")`` pins index 2 and never lands
    SetMode.

    Returns the State dict alongside the port and the log. It is the daemon's
    live State, shared across its connections — writing to it is how a test says
    something changed on the daemon's side of the wire that no command caused,
    which is the only way to express a source change under ``[source]`` mode."""
    servers: list[asyncio.Server] = []

    async def spawn(**overrides: str) -> tuple[int, CommandLog, dict[str, str]]:
        log: CommandLog = []
        state = {**DEFAULTS, **overrides}
        handler = functools.partial(serve_shared, log=log, state=state)
        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        servers.append(server)
        return int(server.sockets[0].getsockname()[1]), log, state

    yield spawn
    for server in servers:
        server.close()
        await server.wait_closed()


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=REPLY_TIMEOUT)
    await client.connect()
    yield client
    await client.close()


@contextlib.asynccontextmanager
async def client_on_a_daemon_with(overrides: dict[str, str]) -> AsyncIterator[ControlClient]:
    """A connected client of a fake daemon whose State carries ``overrides``, both closed at exit."""
    handler = functools.partial(serve, overrides=overrides)
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        yield client
    finally:
        await client.close()
        server.close()
        await server.wait_closed()


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    async with client_on_a_daemon_with({"_metadata": bad}) as client:
        yield client


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    async with client_on_a_daemon_with({"_vol_enabled": "0"}) as client:
        yield client


#: Build a client whose daemon reports the given level back from `State`, or, for
#: ``None``, a `State` frame carrying no volume attribute at all.
DeafVolumeClient = Callable[[str | None], Awaitable[ControlClient]]


@pytest.fixture
async def deaf_volume_client(daemon: DaemonFactory) -> AsyncIterator[DeafVolumeClient]:
    """Clients on daemons whose `Volume` is answered `result="OK"` but never
    applied (the `_deaf` knob), so `State` keeps
    reporting the level the caller names however loud the write was — which is
    how a test says the readback disagrees with what was asked for.

    ``None`` deletes the key from the daemon's live State, so its `State` frame
    goes out with no volume attribute: what a daemon with no engine loaded
    answers, and the case a float readback comparison has nothing to compare."""
    clients: list[ControlClient] = []

    async def build(reported: str | None) -> ControlClient:
        if reported is None:
            port, _log, state = await daemon(_deaf="Volume")
            del state["volume"]
        else:
            port, _log, state = await daemon(_deaf="Volume", volume=reported)
        client = ControlClient("127.0.0.1", port, timeout=2.0)
        await client.connect()
        clients.append(client)
        return client

    yield build
    for client in clients:
        await client.close()


@pytest.fixture
def threaded_daemon_port() -> Iterator[int]:
    yield from spawn_threaded_daemon()


# --- fake HTTP config daemon (port 8088 lane), implemented in fake_http ---


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from fake_http.spawn(fake_http.state())


@pytest.fixture
def restore_refusing_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses every POST /restore: the daemon that is still restarting when a
    # write lands on it and never recovers inside the deadline
    yield from fake_http.spawn(fake_http.state(_restore_refusals=99))


@pytest.fixture
def restore_recovering_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses the first two POST /restore arrivals, then accepts — the restart
    # window a retrying lane is supposed to ride through
    yield from fake_http.spawn(fake_http.state(_restore_refusals=2))


# --- a manager over the Control API fake and an 8088 fake ---


def handshakes(commands: CommandLog) -> int:
    """How many control connections the daemon handshook: one ``GetInfo`` opens each."""
    return sum(1 for name, _ in commands if name == "GetInfo")


class FaultingTransport(httpx.AsyncBaseTransport):
    """The 8088 wire: the fake's own answers until ``fault`` is set, then the exception it makes on a request.

    ``fault`` is called with the request and returns the exception to raise. It raises on every request, or, for a
    transport made ``once``, on the first request only and then lets the fake answer again."""

    def __init__(self, *, once: bool = False) -> None:
        self.inner = httpx.AsyncHTTPTransport()
        self.fault: Callable[[httpx.Request], Exception] | None = None
        self._once = once

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        fault = self.fault
        if fault is not None:
            if self._once:
                self.fault = None
            raise fault(request)
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()


class ManagerRig:
    """The 8088 fakes and the managers a case starts, torn down together: each manager stopped and closed, then
    the fakes."""

    def __init__(self, clock: VirtualClock, tmp_path: Path) -> None:
        """Hold the clock the managers pace on and the directory their backups and presets land in."""
        self._clock = clock
        self._tmp_path = tmp_path
        self._running: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []
        self._served: list[Iterator[dict[str, Any]]] = []

    def serve(self, state: dict[str, Any], handler: type[BaseHTTPRequestHandler] | None = None) -> dict[str, Any]:
        """Serve an 8088 fake on ``state``, answering through ``handler`` where the dict-driven default does not fit;
        its live state, with ``_port`` added."""
        spawned = fake_http.spawn(state, handler=handler)
        self._served.append(spawned)
        return next(spawned)

    def start(
        self, control_port: int, lane: dict[str, Any], *, wire: httpx.AsyncBaseTransport | None = None, **config: object
    ) -> ConnectionManager:
        """Spawn ``run`` on a manager dialing ``control_port`` whose 8088 client reads the fake ``lane``, over ``wire``
        where one is given. ``config`` replaces Config fields."""
        http = HttpConfigClient("127.0.0.1", int(lane["_port"]), "u", "p", HttpOptions(transport=wire))
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": control_port,
            "backup_dir": self._tmp_path / "backups",
            "preset_dir": self._tmp_path / "presets",
        }
        manager = ConnectionManager(Config(**{**defaults, **config}), http, clock=self._clock)
        self._running.append((manager, self._clock.spawn(manager.run()), http))
        return manager

    async def close(self) -> None:
        """Stop and close every manager and client, then stop the fakes."""
        for manager, task, http in self._running:
            manager.stop()
            await asyncio.wait_for(task, READY_CEILING)
            await manager.aclose()
            await http.aclose()
        for spawned in self._served:
            next(spawned, None)


@pytest.fixture
async def manager_rig(clock: VirtualClock, tmp_path: Path) -> AsyncIterator[ManagerRig]:
    """The rig a case starts its managers and 8088 fakes on."""
    rig = ManagerRig(clock, tmp_path)
    yield rig
    await rig.close()


#: What `apply_on_daemon` returns: the rows `apply_live` reported, and the commands the daemon received.
type Applied = tuple[list[LiveWriteResult], CommandLog]


@pytest.fixture
def apply_on_daemon(daemon: DaemonFactory) -> Callable[..., Awaitable[Applied]]:
    """Run `apply_live` over ``edits`` against a fake daemon built with the keyword arguments as its State overrides."""

    async def apply(edits: dict[str, dict[str, str]], **overrides: str) -> Applied:
        port, log, _state = await daemon(**overrides)
        client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
        await client.connect()
        try:
            report = await apply_live(client, edits)
        finally:
            await client.close()
        return report, log

    return apply
