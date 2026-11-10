"""Two things built directly, outside pytest's fixture graph: a REST app on a control daemon and its own 8088 daemon,
both lanes standing, and a port nothing listens on. `live_app` is a plain generator function, so it serves both
`yield from live_app(...)` inside a fixture and `next(app)`/`next(app, None)` by hand around a manually built daemon."""

import asyncio
import contextlib
import socket
from collections.abc import Callable, Iterator
from dataclasses import replace
from http.cookies import Morsel, SimpleCookie
from pathlib import Path

import fake_http
import fake_network
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.api.gate import LOGIN_COOKIE
from hqptuner.config import Config
from hqptuner.core.clock import Clock
from hqptuner.core.manager import ConnectionManager
from hqptuner.metadata import StaticMetadata

METADATA_MIN = Path(__file__).parent / "fixtures" / "metadata_min"

#: A ceiling on the first connect against a fake on loopback, never a duration
#: anything is expected to take: reached only when the fixture is broken.
READY_CEILING = 30.0


def _ready(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["ready"])


async def settled(clock: VirtualClock) -> None:
    """Return once every loop the clock knows of is waiting on it again."""
    await asyncio.wait_for(clock.idle(), READY_CEILING)


async def advanced(clock: VirtualClock, seconds: float) -> None:
    """Let ``seconds`` pass on the clock and return once everything it released
    is waiting on it again, under the same ceiling as ``settled``."""
    await asyncio.wait_for(clock.advance(seconds), READY_CEILING)


class NotAVirtualAppError(TypeError):
    """The client is not serving an app built on a VirtualClock, or is not open."""


def app_of(client: TestClient) -> FastAPI:
    """The FastAPI app under ``client``."""
    app = client.app
    if not isinstance(app, FastAPI):
        raise NotAVirtualAppError
    return app


def app_manager(client: TestClient) -> ConnectionManager:
    """The manager of the app under ``client``."""
    app = app_of(client)
    manager: ConnectionManager = app.state.manager
    return manager


def app_static(client: TestClient) -> StaticMetadata:
    """The static metadata of the app under ``client``."""
    app = client.app
    if not isinstance(app, FastAPI):
        raise NotAVirtualAppError
    static: StaticMetadata = app.state.static
    return static


def _app_clock(client: TestClient) -> VirtualClock:
    """The virtual clock the app under ``client`` was built on."""
    clock = app_manager(client).clock
    if not isinstance(clock, VirtualClock):
        raise NotAVirtualAppError
    return clock


def advance_app(client: TestClient, seconds: float) -> None:
    """Advance the app's clock by ``seconds`` on the app's own event loop, and
    return once everything that released is waiting on it again."""
    portal = client.portal
    if portal is None:
        raise NotAVirtualAppError
    portal.call(advanced, _app_clock(client), seconds)


def settle_app(client: TestClient) -> None:
    """Return once every loop of the app under ``client`` waits on its clock."""
    portal = client.portal
    if portal is None:
        raise NotAVirtualAppError
    portal.call(settled, _app_clock(client))


def wait_for_api(client: TestClient, ready: Callable[[TestClient], bool], polls: int = 20) -> None:
    """Let the app under test settle, then advance its clock one poll interval
    at a time until it reports ready. What it counts is poll passes, never
    seconds; the bound turns a condition that no pass ever meets into a loud
    failure."""
    settle_app(client)
    interval = app_manager(client).cfg.poll_interval
    for _ in range(polls):
        if ready(client):
            return
        advance_app(client, interval)
    raise FixtureError(reason="app never became ready against the fake daemons")


@contextlib.contextmanager
def ready_app(
    cfg: Config,
    clock: VirtualClock | None = None,
    *,
    raise_server_exceptions: bool = True,
    setup: Callable[[FastAPI], None] | None = None,
) -> Iterator[TestClient]:
    """Run the app for ``cfg``, handed over once ``/api/health`` reads ``ready``.

    Both daemons must be answering at the ports ``cfg`` names. The builder raises ``FixtureError`` when the app never
    gets there, so no case acts on an app that is not working. ``setup`` gets the built app before it starts, for a
    case that adds a route of its own. Nothing is logged in.
    """
    app = create_app(cfg, clock or VirtualClock(), fake_network.NETWORK)
    if setup is not None:
        setup(app)
    with TestClient(app, raise_server_exceptions=raise_server_exceptions) as client:
        wait_for_api(client, _ready)
        yield client


def lose_http_client(client: TestClient) -> None:
    """Take the 8088 client away from the app under ``client``, the state of an app that holds no credentials.

    The app has started and read both lanes; this is the lane going missing mid-run, on the app's own event loop.
    """
    portal = client.portal
    if portal is None:
        raise NotAVirtualAppError
    manager = app_manager(client)

    def lose() -> None:
        manager.http_client = None

    portal.call(lose)


def log_in(client: TestClient, *, remember: bool = False) -> TestClient:
    """Log ``client`` in through the real login route with the pair its app holds.

    The pair in force is the pair typed, so the login writes no record. By default it is for a session only and
    writes no secret file either; ``remember`` asks to stay logged in across restarts. The app's 8088 daemon must be
    answering when this runs, because the route asks it whether the pair is right.
    """
    cfg = app_manager(client).cfg
    body = {"username": cfg.hqp_username, "password": cfg.hqp_password, "remember": remember}
    response = client.post("/api/login", json=body)
    if response.status_code != 200:
        raise FixtureError(reason=f"the login was refused with HTTP {response.status_code}: {response.text}")
    return client


def cookie_of(response: httpx.Response) -> Morsel[str]:
    """The login cookie a response sets."""
    jar: SimpleCookie = SimpleCookie()
    jar.load(response.headers["set-cookie"])
    return jar[LOGIN_COOKIE]


@contextlib.contextmanager
def unserved_login(
    cfg: Config,
    clock: Clock | None = None,
    *,
    raise_server_exceptions: bool = True,
    setup: Callable[[FastAPI], None] | None = None,
) -> Iterator[TestClient]:
    """Run the app for ``cfg`` with its client logged in, though no daemon serves its 8088 port.

    A fake 8088 daemon answers for the login alone, on the port ``cfg`` is given, and is taken down before the app
    starts, so the app's own 8088 lane and its ungated readers meet a refused connection from their first read.
    ``setup`` gets the built app before it starts, for a case that adds a route of its own.
    """
    daemon = fake_http.spawn(fake_http.state(), in_process=True)
    state = next(daemon)
    cfg.hqp_http_port = state["_port"]
    app = create_app(cfg, clock, fake_network.NETWORK)
    if setup is not None:
        setup(app)
    client = TestClient(app, raise_server_exceptions=raise_server_exceptions)
    try:
        log_in(client)
    finally:
        state["_take_lane_down"]()
        next(daemon, None)
    with client:
        yield client


def live_app(
    control_port: int,
    tmp_path: Path,
    request_timeout: float | None = None,
    poll_interval: float | None = None,
) -> Iterator[TestClient]:
    """Both lanes standing: the control daemon at ``control_port`` and a fake 8088 daemon of its own, answering for the
    app's whole life and torn down after the client.

    The app holds credentials and is logged in, and the client is handed over once ``/api/health`` reads ``ready``.
    ``poll_interval`` reshapes the manager's background poll the same way ``request_timeout`` reshapes the per-command
    deadline. Passing nothing keeps the production pacing.
    """
    with contextlib.ExitStack() as served:
        http = served.enter_context(contextlib.contextmanager(fake_http.spawn)(fake_http.state(), in_process=True))
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control_port,
            hqp_http_port=http["_port"],
            hqp_username="u",
            hqp_password="p",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            # never the repo's own state/ — a live-snapshot write in a test would land
            # in the dev container's bind mount and outlive the run
            live_preset_file=tmp_path / "live-presets.json",
            # the auto-pilot switch lands beside it for the same reason: a preset
            # test that flips the switch must not stamp the dev container's store
            autopilot_file=tmp_path / "autopilot.json",
            # ADVISOR_ENABLED is off in every build; the suite keeps it on so the
            # preset and snapshot cases still exercise the switch it carries
            advisor_enabled=True,
        )
        if request_timeout is not None:
            cfg = replace(cfg, request_timeout=request_timeout)
        if poll_interval is not None:
            cfg = replace(cfg, poll_interval=poll_interval)
        with ready_app(cfg) as client:
            yield log_in(client)


def closed_port() -> int:
    """A port nothing listens on: bind one, read the number, hand back the hole."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    fake_network.record_closed_port(port)
    return port
