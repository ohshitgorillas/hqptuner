"""Two things built directly, outside pytest's fixture graph: a control-only REST app on a live daemon, and a port
nothing listens on. `live_app` is a plain generator function, so it serves both `yield from live_app(...)` inside a
fixture and `next(app)`/`next(app, None)` by hand around a manually built daemon."""

import asyncio
import socket
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.metadata import StaticMetadata

METADATA_MIN = Path(__file__).parent / "fixtures" / "metadata_min"

#: A ceiling on the first connect against a fake on loopback, never a duration
#: anything is expected to take: reached only when the fixture is broken.
READY_CEILING = 30.0


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


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
    cfg = Config(
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
    if request_timeout is not None:
        cfg = replace(cfg, request_timeout=request_timeout)
    if poll_interval is not None:
        cfg = replace(cfg, poll_interval=poll_interval)
    with TestClient(create_app(cfg, VirtualClock())) as client:
        wait_for_api(client, _reachable)
        yield client


def closed_port() -> int:
    """A port nothing listens on: bind one, read the number, hand back the hole."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port
