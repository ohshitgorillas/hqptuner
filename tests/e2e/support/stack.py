"""The e2e stack: three in-process wire fakes plus the real app in a subprocess.

The fakes are the same ones the offline suite runs against — `fake_control`
(4321), `fake_http` (8088) and `fake_metering` (4322) — each bound to an
ephemeral loopback port inside the test process, so a browser test can read the
recorded control traffic and mutate daemon state directly.

The app under test is the only subprocess. It is launched exactly as the
container launches it (`python -m hqptuner`, Dockerfile) and pointed at the
three fakes through `HQPTUNER_*` environment variables, which is the whole of
its configuration surface (hqptuner/config.py). Nothing is stubbed inside it:
what the browser drives is the shipped app over real HTTP.

`stack()` is a generator shaped for a yield fixture. It yields a `Stack` only
after both `/api/health` and `/api/config` have answered 200 — woken by the
app's own traffic to the two fakes, never a fixed sleep — and on the way out
terminates the app and drains the three fake generators so each runs its own
teardown.
"""

import asyncio
import functools
import json
import os
import socket
import subprocess
import sys
import threading
import urllib.request
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

import fake_http
from fake_control import DEFAULTS, CommandLog, serve_shared

#: Repo root — tests/e2e/support/stack.py, so three parents up. The app is run
#: from here so that a source checkout's `hqptuner` package is importable.
REPO_ROOT = Path(__file__).resolve().parents[3]

#: Hard deadline on app startup.
READY_TIMEOUT = 30.0

#: How long a terminated app gets to exit before it is killed.
TERMINATE_TIMEOUT = 5.0


class NotifyingLog(list[tuple[str, dict[str, str]]]):
    """A control-command log that wakes every waiter the moment the fake appends to it.

    The fake only ever calls `.append` and knows nothing of waiters, so notifying from `append`
    itself reaches every command. It reads as a plain `list` otherwise.
    """

    def __init__(self) -> None:
        """Start empty, with the condition every append below notifies."""
        super().__init__()
        self.condition = threading.Condition()

    def append(self, item: tuple[str, dict[str, str]]) -> None:
        """Record the command and wake every `wait_for_command` blocked on it."""
        with self.condition:
            super().append(item)
            self.condition.notify_all()


class NotifyingState(dict[str, Any]):
    """The HTTP config fake's state dict, wired to wake every waiter the moment a key is set.

    The fakes write every engine attribute a test waits on through `st[key] = value`, so overriding
    `__setitem__` reaches every one of those writes. `dict.update` and construction do not notify;
    nothing waits on either.
    """

    def __init__(self, initial: Mapping[str, Any] = MappingProxyType({})) -> None:
        """Copy in the starting state, then arm the condition every write from here on notifies."""
        super().__init__(initial)
        self.condition = threading.Condition()

    def __setitem__(self, key: str, value: object) -> None:
        """Record the value and wake every waiter blocked on it."""
        with self.condition:
            super().__setitem__(key, value)
            self.condition.notify_all()


@dataclass(frozen=True)
class Stack:
    """A running app plus handles on the three fakes it is talking to."""

    #: Origin of the app under test, e.g. ``http://127.0.0.1:41213`` — no trailing slash.
    base_url: str
    #: Every control-API command the app has sent, in order: ``(name, attrs)``. Notifies on append.
    control_log: NotifyingLog
    #: The control fake's live State, shared across connections — writing to it moves the engine.
    control_state: dict[str, str]
    #: The HTTP config fake's live state (``fake_http.state()``), plus ``_port``. Notifies on write.
    http_state: NotifyingState

    def wait_for_command(self, predicate: Callable[[], bool], timeout: float) -> bool:
        """Block until `predicate()` holds or `timeout` seconds pass, woken by every command the fake logs.

        Quiet on a timeout: it reports whether the predicate held when the wait ended, and never
        raises on its own.
        """
        with self.control_log.condition:
            return self.control_log.condition.wait_for(predicate, timeout=timeout)


def _free_port() -> int:
    """Bind an ephemeral port, read its number, hand back the hole."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


def spawn_control(state: dict[str, str], log: CommandLog) -> Iterator[int]:
    """Serve the control-API fake from a dedicated thread's event loop.

    Modeled on the offline suite's `spawn_threaded_daemon`, with the command
    log wired through: the app runs in another process entirely, so the fake
    must accept from a loop that is not the test's own. One shared `state` dict
    across connections, the way a real daemon has one engine.
    """
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    handler = functools.partial(serve_shared, log=log, state=state)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, "127.0.0.1", 0), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


def _app_env(listen_port: int, control_port: int, http_port: int, metering_port: int, tmp: Path) -> dict[str, str]:
    """The app's whole configuration: the three fakes, a scratch state area, and fast polling.

    Credentials are arbitrary — the HTTP fake authenticates nothing — but they
    must be non-empty, because the app only opens the 8088 lane when it has a
    username and password to open it with.

    EVERY filesystem path the app writes is redirected into `tmp`, not just the
    presets: the narrowing facets, favorites, descriptions and per-preset matrix
    modes all default under the repo's own `state/`, so an app left pointing at
    them boots on whatever the developer last clicked. That is not a hygiene
    point — the narrow bar filters the filter enumerations, so one saved facet
    empties a chain selector and the browser tests read it as the engine
    offering nothing. `scripts/gates/testing/check_e2e_isolation.py` fails the build
    when a new path knob lands here unredirected.
    """
    return {
        **os.environ,
        "HQPTUNER_LISTEN_HOST": "127.0.0.1",
        "HQPTUNER_LISTEN_PORT": str(listen_port),
        "HQPTUNER_HQP_HOST": "127.0.0.1",
        "HQPTUNER_HQP_CONTROL_PORT": str(control_port),
        "HQPTUNER_HQP_HTTP_PORT": str(http_port),
        "HQPTUNER_HQP_METERING_PORT": str(metering_port),
        "HQPTUNER_HQP_USERNAME": "hqplayer",
        "HQPTUNER_HQP_PASSWORD": "password",
        "HQPTUNER_PRESET_DIR": str(tmp / "presets"),
        "HQPTUNER_BACKUP_DIR": str(tmp / "backups"),
        "HQPTUNER_LIVE_PRESET_FILE": str(tmp / "live-presets.json"),
        "HQPTUNER_FAVORITES_FILE": str(tmp / "favorites.json"),
        "HQPTUNER_NARROWING_FILE": str(tmp / "narrowing.json"),
        "HQPTUNER_DESCRIPTION_FILE": str(tmp / "descriptions.json"),
        "HQPTUNER_MATRIX_MODE_FILE": str(tmp / "matrixmodes.json"),
        "HQPTUNER_AUTOPILOT_FILE": str(tmp / "autopilot.json"),
        "HQPTUNER_CONNECTION_FILE": str(tmp / "connection.json"),
        "HQPTUNER_POLL_INTERVAL": "0.1",
        "HQPTUNER_ALARM_THRESHOLD": "0.05",
    }


def _startup_failure(reason: str, log_path: Path) -> str:
    output = log_path.read_text(errors="replace") if log_path.exists() else "<no output captured>"
    return f"e2e stack failed to start: {reason}\n--- app stdout/stderr ---\n{output}"


def _answers(url: str) -> bool:
    """A 200 from the URL, and on `/api/health` the app's own `ready` flag with
    it: the route answers 200 from the moment the app is listening, while
    `ready` is the app saying both daemon lanes are up."""
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:  # noqa: S310 — literal loopback http URL
            if response.status != 200:
                return False
            if not url.endswith("/api/health"):
                return True
            return bool(json.loads(response.read()).get("ready"))
    except OSError:
        return False


def _watch_condition(
    condition: threading.Condition, predicate: Callable[[], bool], timeout: float, mark: Callable[[], None]
) -> None:
    """Block on `condition` until `predicate` holds or `timeout` elapses, then `mark()` if it held."""
    with condition:
        if condition.wait_for(predicate, timeout=timeout):
            mark()


def _wait_for_ready(
    base_url: str,
    proc: "subprocess.Popen[bytes]",
    log_path: Path,
    control_log: NotifyingLog,
    http_state: NotifyingState,
) -> None:
    """Wait until the app serves daemon-derived state, or fail loudly with the app's output.

    `/api/health` alone is not readiness. It reports on the connection manager
    and answers 200 before any lane has loaded anything (api/routes/status.py), while
    `/api/config` answers 503, refusing because nothing has been read from the
    daemon yet, until the first 8088 poll lands (api/deps.py). A stack yielded
    between those two moments hands the session its first fixture call in that
    window, and every test in the run
    errors in setup rather than failing on anything it asserts. So readiness is
    both: the app is up AND it has something from the daemon to serve.

    Nothing here sleeps or reads the clock. The app's own traffic is the
    wake-up: every control command it sends notifies `control_log`, and every
    request that reaches the 8088 fake notifies `http_state` (`_count_request`
    writes `_requests` through `NotifyingState.__setitem__`), so a thread
    blocked on either condition wakes the moment the app has done something
    that could have made it ready, and re-checks the two routes itself. A
    third thread blocks on `proc.wait()` — a real OS wait, not a poll — so an
    app that exits during startup is noticed as soon as it happens rather than
    only at the deadline.
    """
    urls = [f"{base_url}/api/health", f"{base_url}/api/config"]

    def _ready() -> bool:
        return all(_answers(url) for url in urls)

    signaled = threading.Event()
    outcome: dict[str, bool] = {}

    def _mark(key: str) -> None:
        outcome[key] = True
        signaled.set()

    def _mark_ready() -> None:
        _mark("ready")

    def _watch_process() -> None:
        proc.wait()
        _mark("crashed")

    watchers = [
        threading.Thread(
            target=_watch_condition, args=(control_log.condition, _ready, READY_TIMEOUT, _mark_ready), daemon=True
        ),
        threading.Thread(
            target=_watch_condition, args=(http_state.condition, _ready, READY_TIMEOUT, _mark_ready), daemon=True
        ),
        threading.Thread(target=_watch_process, daemon=True),
    ]
    for watcher in watchers:
        watcher.start()
    signaled.wait(timeout=READY_TIMEOUT)
    if outcome.get("crashed"):
        raise RuntimeError(_startup_failure(f"app exited with status {proc.returncode}", log_path))
    if outcome.get("ready"):
        return
    still = [url for url in urls if not _answers(url)]
    refusing = still[0] if still else urls[0]
    raise RuntimeError(_startup_failure(f"{refusing} never answered within {READY_TIMEOUT:.0f}s", log_path))


def _launch_app(env: dict[str, str], log_path: Path) -> "subprocess.Popen[bytes]":
    """Start the app the way the container does, both streams captured to `log_path`."""
    with log_path.open("wb") as sink:
        return subprocess.Popen(
            [sys.executable, "-m", "hqptuner"],
            cwd=REPO_ROOT,
            env=env,
            stdout=sink,
            stderr=subprocess.STDOUT,
        )


def _terminate(proc: "subprocess.Popen[bytes]") -> None:
    proc.terminate()
    try:
        proc.wait(timeout=TERMINATE_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def stack(tmp: Path) -> Iterator[Stack]:
    """Bring the three fakes and the app up, yield the `Stack`, tear it all down.

    `tmp` is a scratch directory the app owns for the run: preset store, backup
    directory, live-snapshot file and the captured startup log all land there, so
    nothing a test does reaches the repo's own `state/`.
    """
    control_state: dict[str, str] = dict(DEFAULTS)
    control_log = NotifyingLog()
    control = spawn_control(control_state, control_log)
    http_state = NotifyingState(fake_http.state())
    http = fake_http.spawn(http_state)
    proc: subprocess.Popen[bytes] | None = None
    try:
        control_port = next(control)
        next(http)
        metering_port = _free_port()
        listen_port = _free_port()
        log_path = tmp / "app.log"
        env = _app_env(listen_port, control_port, int(http_state["_port"]), metering_port, tmp)
        proc = _launch_app(env, log_path)
        base_url = f"http://127.0.0.1:{listen_port}"
        _wait_for_ready(base_url, proc, log_path, control_log, http_state)
        yield Stack(
            base_url=base_url,
            control_log=control_log,
            control_state=control_state,
            http_state=http_state,
        )
    finally:
        if proc is not None:
            _terminate(proc)
        # `close()` would raise GeneratorExit at the yield and skip the teardown
        # that follows it; resuming normally is what runs it.
        next(control, None)
        next(http, None)
