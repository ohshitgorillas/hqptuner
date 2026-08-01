"""Fixture plugin (registered from conftest.py): fake daemons themselves.

The Control API fakes served in the test's own event loop, their pre-baked
variants (split filter slots, garbled metadata, disabled volume), the threaded
ports built on conftest's `spawn_threaded_daemon`, the port-8088 HTTP config
fakes from `fake_http`, and the fake 4322 metering streams."""

import asyncio
import functools
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

import fake_http
import pytest
from conftest import DaemonFactory, spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog, serve
from fake_metering import MeteringStream

from hqptuner.control import ControlClient


@pytest.fixture
async def live_daemon_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def split_filter_daemon_port() -> AsyncIterator[int]:
    """Daemon whose 1x and Nx filter slots DIFFER (1x=2, Nx=0). The default fake
    has both at index 0, where a preserved sibling and a clobbered one are the
    same value — so any test of the one-sided SetFilter case needs this one."""
    handler = functools.partial(serve, overrides={"filter1x": "2", "filterNx": "0"})
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
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
        handler = functools.partial(serve, log=log, state=state)
        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        servers.append(server)
        return int(server.sockets[0].getsockname()[1]), log, state

    yield spawn
    for server in servers:
        server.close()
        await server.wait_closed()


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child (control.py _recover_root)."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    handler = functools.partial(serve, overrides={"_metadata": bad})
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    handler = functools.partial(serve, overrides={"_vol_enabled": "0"})
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


@pytest.fixture
def threaded_daemon_port() -> Iterator[int]:
    yield from spawn_threaded_daemon()


@pytest.fixture
def threaded_disabled_volume_port() -> Iterator[int]:
    """Threaded daemon with volume control disabled — a Volume write is refused."""
    yield from spawn_threaded_daemon({"_vol_enabled": "0"})


# --- fake HTTP config daemon (port 8088 lane), implemented in fake_http ---


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from fake_http.spawn(fake_http.state())


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart archive for one backup read before catching up
    yield from fake_http.spawn(fake_http.state(_lag=1))


@pytest.fixture
def clamping_http_daemon() -> Iterator[dict[str, Any]]:
    # rewrites the startup volume into the volume range on every restore, so a
    # field no apply ever stages comes back different from what was uploaded
    yield from fake_http.spawn(fake_http.state(_clamps=True, defaults_volume="-60", volume_min="-40"))


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the restore, then goes unreachable and never returns
    yield from fake_http.spawn(fake_http.state(_die=True))


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


# --- fake metering stream (port 4322 lane), implemented in fake_metering ----


@pytest.fixture
async def metering_stream() -> AsyncIterator[Callable[..., Any]]:
    """Fake 4322 streams on demand, each closed at teardown."""
    streams: list[MeteringStream] = []

    async def build(repeat: bytes | None = None) -> tuple[MeteringStream, int]:
        stream = MeteringStream(repeat=repeat)
        streams.append(stream)
        return stream, await stream.start()

    yield build
    for stream in streams:
        await stream.close()
