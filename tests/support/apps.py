"""Things built directly, outside pytest's fixture graph: the configs a REST app is built on, a control-only REST app
on a live daemon, and a port nothing listens on. `live_app` is a plain generator function, so it serves both
`yield from live_app(...)` inside a fixture and `next(app)`/`next(app, None)` by hand around a manually built daemon."""

import asyncio
import json
import shutil
import socket
import threading
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

METADATA_MIN = Path(__file__).parent / "fixtures" / "metadata_min"

#: A ceiling on the first connect against a fake on loopback, never a duration
#: anything is expected to take: reached only when the fixture is broken.
READY_CEILING = 30.0


#: The phases health reports while a control connection stands.
STANDING_PHASES = frozenset({"Reachable", "Ready"})


def _phase(client: TestClient) -> str:
    """The phase ``/api/health`` reports for the app under ``client``."""
    return str(client.get("/api/health").json()["phase"])


def connection_stands(client: TestClient) -> bool:
    """Whether health reports a control connection standing: Reachable or Ready."""
    return _phase(client) in STANDING_PHASES


def phase_is_ready(client: TestClient) -> bool:
    """Whether health reports Ready: the configuration lane has answered on the standing connection."""
    return _phase(client) == "Ready"


async def settled(clock: VirtualClock) -> None:
    """Return once every loop the clock knows of is waiting on it again."""
    await asyncio.wait_for(clock.idle(), READY_CEILING)


async def advanced(clock: VirtualClock, seconds: float) -> None:
    """Let ``seconds`` pass on the clock and return once everything it released
    is waiting on it again, under the same ceiling as ``settled``."""
    await asyncio.wait_for(clock.advance(seconds), READY_CEILING)


class NotAVirtualAppError(TypeError):
    """The client is not serving an app built on a VirtualClock, or is not open."""


def app_manager(client: TestClient) -> ConnectionManager:
    """The manager of the app under ``client``."""
    app = client.app
    if not isinstance(app, FastAPI):
        raise NotAVirtualAppError
    manager: ConnectionManager = app.state.manager
    return manager


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


def wait_for_api(client: TestClient, until: Callable[[TestClient], bool], polls: int = 20) -> None:
    """Let the app under test settle, then advance its clock one poll interval
    at a time until ``until`` holds. What it counts is poll passes, never
    seconds; the bound turns a condition that no pass ever meets into a loud
    failure."""
    settle_app(client)
    interval = app_manager(client).cfg.poll_interval
    for _ in range(polls):
        if until(client):
            return
        advance_app(client, interval)
    raise FixtureError(reason="app never became ready against the fake daemons")


def control_config(control_port: int, tmp_path: Path) -> Config:
    """The config of an app that talks to one fake control daemon and carries no credentials, so it talks 4321 alone,
    with every store under ``tmp_path``. A case that needs more, such as a metering port, ``replace``s it onto this."""
    return Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_username="",
        hqp_password="",
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


def two_lane_config(http_daemon: dict[str, Any], control_port: int, tmp_path: Path) -> Config:
    """The config of an app on both fakes at once, control on a threaded 4321 daemon and config on the 8088 one, with
    the advisor on and every store under ``tmp_path``. A case that needs more ``replace``s it onto this."""
    return Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
        advisor_enabled=True,
        hqp_home="/x/home",
    )


def served_settings(tmp_path: Path, settings: dict[str, Any], group: str) -> dict[str, Any]:
    """The ``group`` table of ``settings`` that ``/api/metadata`` serves from a copy of the shared minimal metadata
    fixture whose ``settings.json`` is replaced with ``settings``, with no daemon behind the app."""
    data_dir = tmp_path / "metadata"
    shutil.copytree(METADATA_MIN, data_dir)
    (data_dir / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=closed_port(), data_dir=data_dir)
    with TestClient(create_app(cfg, VirtualClock())) as client:
        table: dict[str, Any] = client.get("/api/metadata").json()["settings"][group]
    return table


def served_ceiling(client: TestClient, polls: int) -> float | None:
    """The ceiling of the first junk recommendation `/api/status` serves within ``polls`` poll passes, or None."""
    interval = app_manager(client).cfg.poll_interval
    for _ in range(polls):
        junk = client.get("/api/status").json()["data"]["junk"]
        if junk is not None:
            ceiling: float = junk["ceiling_khz"]
            return ceiling
        advance_app(client, interval)
    return None


def live_app(
    control_port: int,
    tmp_path: Path,
    request_timeout: float | None = None,
    poll_interval: float | None = None,
) -> Iterator[TestClient]:
    """Control lane only — no credentials, so the app talks 4321 alone.

    ``poll_interval`` reshapes the manager's background poll the same way
    ``request_timeout`` reshapes the per-command deadline. Passing nothing keeps
    the production pacing."""
    cfg = control_config(control_port, tmp_path)
    if request_timeout is not None:
        cfg = replace(cfg, request_timeout=request_timeout)
    if poll_interval is not None:
        cfg = replace(cfg, poll_interval=poll_interval)
    with TestClient(create_app(cfg, VirtualClock())) as client:
        wait_for_api(client, connection_stands)
        yield client


#: A connection handler an asyncio server runs for each client that connects.
type Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


def serve_on_thread(handler: Handler, host: str = "127.0.0.1", bind_port: int = 0) -> Iterator[int]:
    """Serve ``handler`` on a loop of its own, in a thread of its own, over real TCP; shaped for a yield fixture.

    The app under test runs its own event loop, in a `TestClient`'s thread or in another process altogether, and a
    server on the test's loop answers nothing while a synchronous test body holds that loop. Yields the port; the end
    of the generator stops the server and joins the thread.
    """
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, host, bind_port), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


#: The sockets behind every port ``closed_port`` has handed out to the running test.
_held: list[socket.socket] = []


def closed_port() -> int:
    """A port nothing listens on: bound and never listened on, so a connect to it is refused and no other socket
    can bind it, until ``release_closed_ports`` closes it at the end of the test."""
    sock = socket.socket()
    _held.append(sock)
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    return port


def release_closed_ports() -> None:
    """Close every socket ``closed_port`` holds, so its port is free again."""
    while _held:
        _held.pop().close()
