"""Fixture plugin (registered from conftest.py): fake daemons themselves.

The Control API fakes registered on the in-process network (`fake_network`), their
pre-baked variants (split filter slots, garbled metadata, disabled volume), the
ports conftest's `spawn_threaded_daemon` registers for tests whose app runs in a
`TestClient`, and the port-8088 HTTP config fakes from `fake_http`. None holds a
listener or a thread."""

import asyncio
import contextlib
import functools
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from typing import Any

import fake_http
import fake_network
import pytest
from conftest import DaemonFactory, spawn_threaded_daemon
from fake_control import DEFAULTS, CommandLog, serve, serve_shared
from fake_network import NETWORK

from hqptuner.engine.control import ControlClient


@pytest.fixture
def live_daemon_port() -> Iterator[int]:
    with fake_network.serving(serve) as port:
        yield port


@pytest.fixture
def daemon() -> Iterator[DaemonFactory]:
    """Fake daemons on demand, each with its own recorded traffic and its own
    State. Keyword arguments are the State overrides the fixtures above bake in
    one apiece: ``daemon(rate="2", _deaf="SetMode")`` pins index 2 and never lands
    SetMode.

    Returns the State dict alongside the port and the log. It is the daemon's
    live State, shared across its connections — writing to it is how a test says
    something changed on the daemon's side of the wire that no command caused,
    which is the only way to express a source change under ``[source]`` mode."""
    with contextlib.ExitStack() as registered:

        def spawn(**overrides: str) -> Awaitable[tuple[int, CommandLog, dict[str, str]]]:
            # Registered before it is returned; the awaitable only hands the result over, which is the shape every
            # caller awaits.
            log: CommandLog = []
            state = {**DEFAULTS, **overrides}
            handler = functools.partial(serve_shared, log=log, state=state)
            return asyncio.sleep(0, (registered.enter_context(fake_network.serving(handler)), log, state))

        yield spawn


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=2.0, opener=NETWORK.open_stream)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    handler = functools.partial(serve, overrides={"_metadata": bad})
    with fake_network.serving(handler) as port:
        client = ControlClient("127.0.0.1", port, timeout=2.0, opener=NETWORK.open_stream)
        await client.connect()
        yield client
        await client.close()


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    handler = functools.partial(serve, overrides={"_vol_enabled": "0"})
    with fake_network.serving(handler) as port:
        client = ControlClient("127.0.0.1", port, timeout=2.0, opener=NETWORK.open_stream)
        await client.connect()
        yield client
        await client.close()


#: Build a client whose daemon reports the given level back from `State`, or, for
#: ``None``, a `State` frame carrying no volume attribute at all.
DeafVolumeClient = Callable[[str | None], Awaitable[ControlClient]]


@pytest.fixture
async def deaf_volume_client(daemon: DaemonFactory) -> AsyncIterator[DeafVolumeClient]:
    """Clients on daemons whose `Volume` is answered `result="OK"` but never
    applied (the `_deaf` knob, protocol.md §6: OK is not proof), so `State` keeps
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
        client = ControlClient("127.0.0.1", port, timeout=2.0, opener=NETWORK.open_stream)
        await client.connect()
        clients.append(client)
        return client

    yield build
    for client in clients:
        await client.close()


@pytest.fixture
def threaded_daemon_port() -> Iterator[int]:
    yield from spawn_threaded_daemon()


@pytest.fixture
def threaded_disabled_volume_port() -> Iterator[int]:
    """Registered daemon with volume control disabled — a Volume write is refused."""
    yield from spawn_threaded_daemon({"_vol_enabled": "0"})


# --- fake HTTP config daemon (port 8088 lane), implemented in fake_http ---


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from fake_http.spawn(fake_http.state(), in_process=True)


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart archive for one backup read before catching up
    yield from fake_http.spawn(fake_http.state(_lag=1), in_process=True)


@pytest.fixture
def clamping_http_daemon() -> Iterator[dict[str, Any]]:
    # rewrites the startup volume into the volume range on every restore, so a
    # field no apply ever stages comes back different from what was uploaded
    yield from fake_http.spawn(fake_http.state(_clamps=True, defaults_volume="-60", volume_min="-40"), in_process=True)


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the restore, then goes unreachable and never returns
    yield from fake_http.spawn(fake_http.state(_die=True), in_process=True)


@pytest.fixture
def restore_refusing_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses every POST /restore: the daemon that is still restarting when a
    # write lands on it and never recovers inside the deadline
    yield from fake_http.spawn(fake_http.state(_restore_refusals=99), in_process=True)


@pytest.fixture
def restore_recovering_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses the first two POST /restore arrivals, then accepts — the restart
    # window a retrying lane is supposed to ride through
    yield from fake_http.spawn(fake_http.state(_restore_refusals=2), in_process=True)
