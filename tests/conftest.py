"""Shared fixtures over the two fake daemons (docs/testing.md — fakes speak the
wire protocol, over a real socket).

The Control API fake itself is `fake_control`; the port-8088 HTTP fake is
`fake_http`. The fixture families over them live in the plugin modules
registered below: the daemons themselves in `fixtures_daemons`, the
`TestClient`s over the REST app in `fixtures_clients`. What stays here is the
autouse guards, the helpers test modules import by name (`spawn_threaded_daemon`,
`_live_app`, `wait_for_api`, `eventually`, `running_reader`, the type aliases),
and the manager fixtures built on them."""

import asyncio
import contextlib
import functools
import socket
import threading
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fake_control import CommandLog, serve
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.metering import MeteringReader, TrackContext

pytest_plugins = ["fixtures_daemons", "fixtures_clients"]

#: Every Config field whose default points into the repo checkout — the state/
#: files the dev container bind-mounts, plus the backup and preset dirs. Env
#: name to the filename the guard parks it under.
_REPO_PATH_ENVS = {
    "HQPTUNER_AUTOPILOT_FILE": "autopilot.json",
    "HQPTUNER_LIVE_PRESET_FILE": "live-presets.json",
    "HQPTUNER_FAVORITES_FILE": "favorites.json",
    "HQPTUNER_NARROWING_FILE": "narrowing.json",
    "HQPTUNER_DESCRIPTION_FILE": "descriptions.json",
    "HQPTUNER_MATRIX_MODE_FILE": "matrixmodes.json",
    "HQPTUNER_BACKUP_DIR": "backups",
    "HQPTUNER_PRESET_DIR": "presets",
}


@pytest.fixture(scope="session", autouse=True)
def _state_never_touches_the_repo(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
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


#: Invented metadata for the app under test: join and lookup mechanics run on
#: this, never on the shipped prose (docs/testing.md rule 9).
METADATA_MIN = Path(__file__).parent / "support" / "fixtures" / "metadata_min"


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


def _live_app(
    control_port: int,
    tmp_path: Path,
    request_timeout: float | None = None,
    poll_interval: float | None = None,
) -> Iterator[TestClient]:
    """Control lane only — no credentials, so the app talks 4321 alone.

    ``poll_interval`` reshapes the manager's background poll the same way
    ``request_timeout`` reshapes the per-command deadline: a caller that must be
    the only traffic its fake daemon sees parks the poll out past the case.
    Passing nothing keeps the production pacing."""
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
    )
    if request_timeout is not None:  # real wall clock, unlike the virtualized one
        cfg = replace(cfg, request_timeout=request_timeout)
    if poll_interval is not None:
        cfg = replace(cfg, poll_interval=poll_interval)
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, _reachable)
        yield client


DaemonFactory = Callable[..., Awaitable[tuple[int, CommandLog, dict[str, str]]]]

#: A manager already connected to a fake daemon, that daemon's recorded traffic,
#: and its live State — writing to the State is how a test says the engine moved
#: with no command sent (a source change under ``[source]`` mode).
LiveBuilt = tuple[ConnectionManager, CommandLog, dict[str, str]]
LiveManager = Callable[..., Awaitable[LiveBuilt]]


async def eventually(condition: Callable[[], bool], timeout: float = 3.0) -> None:  # noqa: ASYNC109
    """Wait until the condition holds; a TimeoutError means the behavior never
    happened. Real clock with tiny polls, because ``run()`` is deliberately
    real-paced (docs/testing.md §7) — the lanes' own waits stay virtual.

    ASYNC109 and ASYNC110 are suppressed rather than fixed: the helper polls a
    caller-supplied ``condition()``, so by construction there is no mutation
    point to hang an ``asyncio.Event`` on."""

    async def wait() -> None:
        while not condition():  # noqa: ASYNC110
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


# --- a manager running BOTH lanes, 4321 and 8088 ----------------------------

#: Start a manager against the 4321 fake plus an 8088 lane on the given port,
#: settled before it comes back; keyword arguments override its Config.
StartManager = Callable[..., Coroutine[Any, Any, ConnectionManager]]


async def settled(manager: ConnectionManager) -> None:
    """A full connect plus one completed poll. ``run()`` flags the daemon
    reachable before the best-effort 8088 loads run, so the flag alone cannot
    prove the connect returned whole — a completed poll can."""
    await eventually(lambda: manager.reachable and manager.readings.loaded_at is not None, timeout=5.0)
    first = manager.readings.loaded_at
    await eventually(lambda: manager.reachable and manager.readings.loaded_at != first, timeout=5.0)


@pytest.fixture
async def start_manager(live_daemon_port: int, tmp_path: Path) -> AsyncIterator[StartManager]:
    """Run a manager against the 4321 fake plus an 8088 lane at ``http_port``,
    waiting until it has settled; everything is torn down at exit."""
    started: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def start(http_port: int, **overrides: Any) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": live_daemon_port,
            "poll_interval": 0.02,
            "backup_dir": tmp_path / "backups",
            "preset_dir": tmp_path / "presets",
        }
        manager = ConnectionManager(Config(**{**defaults, **overrides}), http)
        task = asyncio.create_task(manager.run())
        started.append((manager, task, http))
        await settled(manager)
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
    overrides: dict[str, str] | None = None, state: dict[str, str] | None = None, log: CommandLog | None = None
) -> Iterator[int]:
    # `state` shares ONE dict across connections, as the `daemon` fixture does —
    # how a sync test moves a daemon the app has already connected to; `log`
    # likewise, so a sync test can watch the daemon's side of the wire
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    handler = functools.partial(serve, overrides=overrides, state=state, log=log)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, "127.0.0.1", 0), loop).result()
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


# --- ports and guards for the REST app under test ---------------------------


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


@pytest.fixture(autouse=True, scope="session")
def _never_the_hosts_metering_port() -> Iterator[None]:
    """No test may open the host daemon's metering side channel. The default
    port is the running daemon's (config.py), so point the default at a hole:
    an app built without an explicit port then dials nothing. Cases that want a
    stream pass ``hqp_metering_port`` themselves and are unaffected."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("HQPTUNER_HQP_METERING_PORT", str(_closed_port()))
        yield


# --- metering reader harness (fake 4322 stream lives in fixtures_daemons) ---

#: A playing 96 kHz PCM track with no junk filter engaged — the context under
#: which the metering reader accumulates evidence.
PLAYING = TrackContext(playing=True, track_serial="track-1", samplerate=96000, sdm=False, junk_filter="none")


async def _instant(_seconds: float) -> None:
    await asyncio.sleep(0)


@contextlib.asynccontextmanager
async def running_reader(
    port: int,
    cell: list[TrackContext | None],
    sleep: Callable[[float], Any] = _instant,
) -> AsyncIterator[tuple[MeteringReader, "asyncio.Task[None]"]]:
    """A MeteringReader running against the given port, reading its context
    from ``cell[0]``, stopped and awaited on exit."""
    reader = MeteringReader("127.0.0.1", port, lambda: cell[0], sleep=sleep)
    task = asyncio.create_task(reader.run())
    try:
        yield reader, task
    finally:
        reader.stop()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def wait_for_api(client: TestClient, ready: Callable[[TestClient], bool], tries: int = 10_000) -> None:
    """Spin on real requests — never a wall-clock sleep — until the app under
    test reports ready. The app's ConnectionManager loads from the fakes inside
    the client's own loop, which progresses between requests, so this converges
    in a handful of passes; the bound only turns a hang into a loud failure."""
    for _ in range(tries):
        if ready(client):
            return
    pytest.fail("app never became ready against the fake daemons")
