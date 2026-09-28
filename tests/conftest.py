"""Shared fixtures over the two fake daemons (docs/testing.md — fakes speak the
wire protocol, over a real socket).

The Control API fake itself is `fake_control`; the port-8088 HTTP fake is
`fake_http`. The fixture families over them live in the plugin modules
registered below: the daemons themselves in `fixtures_daemons`, the
`TestClient`s over the REST app in `fixtures_clients`. What stays here is the
autouse guards, the helpers test modules import by name (`spawn_threaded_daemon`,
the type aliases) — `live_app`/`closed_port`/`wait_for_api`/`advance_app`/
`app_manager`/`settle_app`/`settled`/`advanced` (the plain functions, not the
fixture below) live in `apps` now, imported from there directly by every test
module that wants one — and the manager fixtures built on them."""

import asyncio
import functools
import os
import struct
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import apps
import pytest
from apps import settled
from fake_control import CommandLog, serve
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

pytest_plugins = ["fixtures_daemons", "fixtures_clients"]

#: Every Config field whose default points into the repo checkout — the state/
#: files the dev container bind-mounts, plus the backup and preset dirs. Env
#: name to the filename the guard parks it under.
_REPO_PATH_ENVS = {
    "HQPTUNER_AUTOPILOT_FILE": "autopilot.json",
    "HQPTUNER_CONNECTION_FILE": "connection.json",
    "HQPTUNER_LIVE_PRESET_FILE": "live-presets.json",
    "HQPTUNER_FAVORITES_FILE": "favorites.json",
    "HQPTUNER_NARROWING_FILE": "narrowing.json",
    "HQPTUNER_DESCRIPTION_FILE": "descriptions.json",
    "HQPTUNER_MATRIX_MODE_FILE": "matrixmodes.json",
    "HQPTUNER_BACKUP_DIR": "backups",
    "HQPTUNER_PRESET_DIR": "presets",
}


#: The one ``HQPTUNER_*`` name the shell keeps: it points at the host's own
#: chromium binary, which is a fact about the machine the browser suite runs on
#: rather than a knob the app reads. Scrubbing it would send e2e to playwright's
#: bundled browser instead.
_KEPT_ENVS = frozenset({"HQPTUNER_CHROMIUM"})


@pytest.fixture(scope="session", autouse=True)
def _no_inherited_environment() -> Iterator[dict[str, str]]:
    """No test reads a knob the shell happened to export (docs/testing.md rule
    16), and the suite still knows what that shell said.

    The suite is run from shells carrying ``HQPTUNER_*`` variables for their own
    reasons — sourced credentials, a hand-set store path, a daemon address — and
    a fixture that forgets an override then reads the developer's value instead
    of the harness's, which is a test of the machine it ran on. So every one of
    those names is dropped for the whole session before any other fixture runs,
    and the mapping is yielded to the two guards below and to the one place that
    wants the shell's own values back: the live canary, which is about the real
    daemon at the real address."""
    captured = {name: value for name, value in os.environ.items() if name.startswith("HQPTUNER_")}
    with pytest.MonkeyPatch.context() as mp:
        for name in captured.keys() - _KEPT_ENVS:
            mp.delenv(name, raising=False)
        yield captured


@pytest.fixture(scope="session", autouse=True)
def _state_never_touches_the_repo(
    _no_inherited_environment: dict[str, str], tmp_path_factory: pytest.TempPathFactory
) -> Iterator[None]:
    """Backstop: a bare ``Config()`` in any test resolves its state paths into a
    session tmp dir, never the repo's own ``state/``.

    The repo defaults are the dev container's bind mount — the running
    install's live state. A test fixture that forgets one ``*_file`` override
    must land here, not there; forgetting has already stamped the real
    auto-pilot store off mid-listen. Explicit per-test ``tmp_path`` overrides in
    fixtures remain the first line; this exists so the next omission costs
    nothing."""
    tmp = tmp_path_factory.mktemp("repo-path-guard")
    with pytest.MonkeyPatch.context() as mp:
        for env, name in _REPO_PATH_ENVS.items():
            mp.setenv(env, str(tmp / name))
        yield


@pytest.fixture
def clock() -> VirtualClock:
    """The clock every manager and app under test paces on: retry, verify and
    poll loops run the same passes against the fakes, in virtual time."""
    return VirtualClock()


#: Invented metadata for the app under test: join and lookup mechanics run on
#: this, never on the shipped prose (docs/testing.md rule 9).
METADATA_MIN = Path(__file__).parent / "support" / "fixtures" / "metadata_min"

#: Bytes of a WAVE container before its samples: RIFF form header, a 16-byte
#: PCM `fmt ` chunk, and the `data` chunk header.
WAVE_HEADER_BYTES = 44


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


def minimal_wave(size: int = WAVE_HEADER_BYTES + 2) -> bytes:
    """A minimal PCM WAVE container, one 16-bit channel at 44100 Hz, whose
    `data` chunk is padded with null samples so the whole file is exactly
    ``size`` bytes (46 at least: the header plus one sample). The RIFF form and
    `data` sizes are kept in step with the padding, so a strict and a lax
    container check accept the same bytes."""
    data_len = size - WAVE_HEADER_BYTES
    if data_len < 2:
        raise FixtureError(reason="a WAVE container needs at least one sample")
    fmt = struct.pack("<HHIIHH", 1, 1, 44100, 88200, 2, 16)
    return b"".join(
        [
            b"RIFF",
            struct.pack("<I", 4 + 8 + len(fmt) + 8 + data_len),
            b"WAVE",
            b"fmt ",
            struct.pack("<I", len(fmt)),
            fmt,
            b"data",
            struct.pack("<I", data_len),
            bytes(data_len),
        ]
    )


DaemonFactory = Callable[..., Awaitable[tuple[int, CommandLog, dict[str, str]]]]

#: A manager already connected to a fake daemon, that daemon's recorded traffic,
#: and its live State — writing to the State is how a test says the engine moved
#: with no command sent (a source change under ``[source]`` mode).
LiveBuilt = tuple[ConnectionManager, CommandLog, dict[str, str]]
LiveManager = Callable[..., Awaitable[LiveBuilt]]


@pytest.fixture
async def live_manager(daemon: DaemonFactory, clock: VirtualClock) -> AsyncIterator[LiveManager]:
    """Build managers on fake daemons, each connected and idle on the clock
    when handed over, stopping each at teardown.

    Keyword arguments are the daemon's State overrides — ``rate="2"`` starts the
    engine already pinned, ``mode="2"`` starts it with the SDM chain loaded,
    ``_deaf="SetMode"`` starts one whose ``SetMode`` answers OK without applying
    (protocol.md §4: OK is not proof). A case that waits on the manager's own
    poll loop advances the clock by a ``poll_interval``.
    """
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def build(**overrides: str) -> LiveBuilt:
        port, log, state = await daemon(**overrides)
        manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port), clock=clock)
        task = clock.spawn(manager.run())
        started.append((manager, task))
        await settled(clock)
        return manager, log, state

    yield build
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()


# --- a manager running BOTH lanes, 4321 and 8088 ----------------------------

#: Start a manager against the 4321 fake plus an 8088 lane on the given port;
#: keyword arguments override its Config.
StartManager = Callable[..., Coroutine[Any, Any, ConnectionManager]]


@pytest.fixture
async def start_manager(live_daemon_port: int, tmp_path: Path, clock: VirtualClock) -> AsyncIterator[StartManager]:
    """Run a manager against the 4321 fake plus an 8088 lane at ``http_port``,
    handed over once its first connect has run and it idles on the clock;
    everything is torn down at exit."""
    started: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def start(http_port: int, **overrides: object) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": live_daemon_port,
            "backup_dir": tmp_path / "backups",
            "preset_dir": tmp_path / "presets",
        }
        manager = ConnectionManager(Config(**{**defaults, **overrides}), http, clock)
        task = clock.spawn(manager.run())
        started.append((manager, task, http))
        await settled(clock)
        return manager

    yield start
    for manager, task, http in started:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


# --- the same control-daemon fake, served from a background thread ----------
# `TestClient` runs the app (and its ConnectionManager) inside its own thread's
# event loop, where the in-loop asyncio fakes above are unreachable: their
# server only accepts while the test's loop is running, and it is parked for
# the duration of a sync test body. These serve the identical `serve` protocol
# from a dedicated thread over real TCP, reachable from any loop.


def spawn_threaded_daemon(
    overrides: dict[str, str] | None = None,
    state: dict[str, str] | None = None,
    log: CommandLog | None = None,
    host: str = "127.0.0.1",
    bind_port: int = 0,
) -> Iterator[int]:
    # `state` shares ONE dict across connections, as the `daemon` fixture does —
    # how a sync test moves a daemon the app has already connected to; `log`
    # likewise, so a sync test can watch the daemon's side of the wire.
    # `host`/`bind_port` put daemons at two loopback ADDRESSES on one port number,
    # which is what a test of which address the app dials needs; the defaults
    # keep every existing caller on an ephemeral 127.0.0.1 port.
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    handler = functools.partial(serve, overrides=overrides, state=state, log=log)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, host, bind_port), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


# --- a manager wired to the fake HTTP config daemon -------------------------

ManagerFactory = Callable[..., ConnectionManager]


@pytest.fixture
async def http_manager_factory(tmp_path: Path, clock: VirtualClock) -> AsyncIterator[ManagerFactory]:
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

    def build(daemon: dict[str, Any], **overrides: object) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
        clients.append(http)
        defaults: dict[str, Any] = {
            "alarm_threshold": 1.0,
            "backup_dir": tmp_path,
            "preset_dir": tmp_path / "presets",
        }
        return ConnectionManager(Config(**{**defaults, **overrides}), http, clock)

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


# --- ports and guards for the REST app under test ---------------------------


@pytest.fixture
def closed_port() -> int:
    return apps.closed_port()


@pytest.fixture(autouse=True, scope="session")
def _never_the_hosts_metering_port(_no_inherited_environment: dict[str, str]) -> Iterator[None]:
    """No test may open the host daemon's metering side channel. The default
    port is the running daemon's (config.py), so point the default at a hole:
    an app built without an explicit port then dials nothing. Cases that want a
    stream pass ``hqp_metering_port`` themselves and are unaffected."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("HQPTUNER_HQP_METERING_PORT", str(apps.closed_port()))
        yield
