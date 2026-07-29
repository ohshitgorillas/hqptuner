"""Shared fixtures over the two fake daemons (docs/testing.md — fakes speak the
wire protocol, over a real socket).

The Control API fake itself is `fake_control`; the port-8088 HTTP fake is
`fake_http`. What lives here is the ways of standing them up: in the test's own
event loop, from a background thread for the sync `TestClient` cases, and as a
factory for tests that need several or need to move one mid-session."""

import asyncio
import functools
import socket
import threading
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from fake_control import DEFAULTS, CommandLog, serve
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.control import ControlClient
from hqptuner.manager import ConnectionManager


@pytest.fixture(autouse=True)
def virtual_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry/verify loops pay their waits in virtual time, not wall clock.

    Every lane deadline loop is paced by `ConnectionManager.sleep` against a
    deadline read from `ConnectionManager.monotonic` — the two public seams the
    lanes are written to. Here `sleep` advances an offset that `monotonic` reads
    back, so a loop still runs the same iterations against the fake daemon and
    still exits on the same condition, without the seconds. Real sleeps cost the
    offline suite ~80 s of its 84 s.

    The manager's own poll loop is deliberately left on the wall clock: `run()`
    paces on the private stop-event wait (`_sleep`), which this does not touch,
    so a running manager does not spin."""
    offset = 0.0

    async def sleep(_self: ConnectionManager, seconds: float) -> None:
        nonlocal offset
        offset += seconds
        await asyncio.sleep(0)  # still yield: concurrent tasks must interleave

    def monotonic(_self: ConnectionManager) -> float:
        return time.monotonic() + offset

    monkeypatch.setattr(ConnectionManager, "sleep", sleep)
    monkeypatch.setattr(ConnectionManager, "monotonic", monotonic)


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


DaemonFactory = Callable[..., Awaitable[tuple[int, CommandLog, dict[str, str]]]]


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


#: A manager already connected to a fake daemon, that daemon's recorded traffic,
#: and its live State — writing to the State is how a test says the engine moved
#: with no command sent (a source change under ``[source]`` mode).
LiveBuilt = tuple[ConnectionManager, CommandLog, dict[str, str]]
LiveManager = Callable[..., Awaitable[LiveBuilt]]


async def eventually(condition: Callable[[], bool], timeout: float = 3.0) -> None:
    """Wait until the condition holds; a TimeoutError means the behavior never
    happened. Real clock with tiny polls, because ``run()`` is deliberately
    real-paced (docs/testing.md §7) — the lanes' own waits stay virtual."""

    async def wait() -> None:
        while not condition():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), timeout)


@pytest.fixture
async def live_manager(daemon: DaemonFactory) -> AsyncIterator[LiveManager]:
    """Build managers on fake daemons, stopping each at teardown.

    Keyword arguments are the daemon's State overrides — ``rate="2"`` starts the
    engine already pinned, ``mode="2"`` starts it with the SDM chain loaded,
    ``_deaf="SetMode"`` starts one whose ``SetMode`` answers OK without applying
    (protocol.md §4: OK is not proof). A case that waits on the manager's own
    poll loop passes a small ``poll_interval``; the rest keep the production
    pacing, so no background poll interleaves with what they assert on.
    """
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def build(poll_interval: float | None = None, **overrides: str) -> LiveBuilt:
        port, log, state = await daemon(**overrides)
        settings: dict[str, Any] = {"hqp_host": "127.0.0.1", "hqp_control_port": port}
        if poll_interval is not None:
            settings["poll_interval"] = poll_interval
        manager = ConnectionManager(Config(**settings))
        task = asyncio.create_task(manager.run())
        await eventually(lambda: manager.reachable)
        started.append((manager, task))
        return manager, log, state

    yield build
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()


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


# --- the same control-daemon fake, served from a background thread ----------
# `TestClient` runs the app (and its ConnectionManager) inside its own thread's
# event loop, where the in-loop asyncio fakes above are unreachable: their
# server only accepts while the test's loop is running, and it is parked for
# the duration of a sync test body. These serve the identical `serve` protocol
# from a dedicated thread over real TCP, reachable from any loop.


def spawn_threaded_daemon(overrides: dict[str, str] | None = None) -> Iterator[int]:
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    handler = functools.partial(serve, overrides=overrides)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, "127.0.0.1", 0), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


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


# --- a manager wired to the fake HTTP config daemon -------------------------

ManagerFactory = Callable[..., ConnectionManager]


@pytest.fixture
async def http_manager_factory(tmp_path: Path) -> AsyncIterator[ManagerFactory]:
    """Build managers on a fake 8088 daemon, closing every client at teardown.

    Six write-lane suites each hand-rolled this. The daemon is an argument
    because the outage suites want the ``dying``/``stale`` variants; keyword
    arguments override the Config for the suites that need a different one (a
    longer ``alarm_threshold`` for the stale-readback case, ``hqp_home`` for the
    filter-upload path assertions).

    ``alarm_threshold`` defaults to 1.0 so a rejected apply gives up after a
    couple of virtual polls rather than the production 15 s window; the backup
    and preset directories land in ``tmp_path``, never in the repo.
    """
    clients: list[HttpConfigClient] = []

    def build(daemon: dict[str, Any], **overrides: Any) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
        clients.append(http)
        defaults: dict[str, Any] = {
            "alarm_threshold": 1.0,
            "backup_dir": tmp_path,
            "preset_dir": tmp_path / "presets",
        }
        return ConnectionManager(Config(**{**defaults, **overrides}), http)

    yield build
    for http in clients:
        await http.aclose()


@pytest.fixture
def http_manager(http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]) -> ConnectionManager:
    """The common case: one manager on the healthy fake daemon."""
    return http_manager_factory(http_daemon)


@pytest.fixture
def clamping_manager(http_manager_factory: ManagerFactory, clamping_http_daemon: dict[str, Any]) -> ConnectionManager:
    """A manager whose daemon rewrites a setting the user never staged."""
    return http_manager_factory(clamping_http_daemon)


# --- the REST app under test ------------------------------------------------


def _closed_port() -> int:
    """A port nothing listens on: bind one, read the number, hand back the hole."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
def closed_port() -> int:
    return _closed_port()


@pytest.fixture
def api_client() -> Iterator[TestClient]:
    """The REST surface with no daemon behind it (control lane at a closed port,
    no credentials) — for the routes whose behavior is guards and buffering
    rather than daemon traffic."""
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=_closed_port())
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


@pytest.fixture
def http_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The REST surface with its http lane wired to the faithful fake 8088
    daemon; control lane at a closed port (http-only operations never touch it).
    Small alarm so a rejected apply times out fast; backups, presets, and parked
    filters land in tmp, never in the repo; `hqp_home` is pinned so filter-upload
    path assertions read verbatim."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        hqp_home="/x/home",
    )
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


def wait_for_api(client: TestClient, ready: Callable[[TestClient], bool], tries: int = 10_000) -> None:
    """Spin on real requests — never a wall-clock sleep — until the app under
    test reports ready. The app's ConnectionManager loads from the fakes inside
    the client's own loop, which progresses between requests, so this converges
    in a handful of passes; the bound only turns a hang into a loud failure."""
    for _ in range(tries):
        if ready(client):
            return
    pytest.fail("app never became ready against the fake daemons")
