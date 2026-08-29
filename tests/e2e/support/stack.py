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
after both `/api/health` and `/api/config` have answered 200 — a bounded poll,
never a fixed sleep — and on the way out terminates the app and drains the three
fake generators so each runs its own teardown.
"""

import asyncio
import functools
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fake_http
import fake_metering
from fake_control import DEFAULTS, CommandLog, serve

#: Repo root — tests/e2e/support/stack.py, so three parents up. The app is run
#: from here so that a source checkout's `hqptuner` package is importable.
REPO_ROOT = Path(__file__).resolve().parents[3]

#: Hard deadline on app startup, and the gap between readiness probes.
READY_TIMEOUT = 30.0
READY_POLL = 0.05

#: How long a terminated app gets to exit before it is killed.
TERMINATE_TIMEOUT = 5.0


@dataclass(frozen=True)
class Stack:
    """A running app plus handles on the three fakes it is talking to."""

    #: Origin of the app under test, e.g. ``http://127.0.0.1:41213`` — no trailing slash.
    base_url: str
    #: Every control-API command the app has sent, in order: ``(name, attrs)``.
    control_log: CommandLog
    #: The control fake's live State, shared across connections — writing to it moves the engine.
    control_state: dict[str, str]
    #: The HTTP config fake's live state (``fake_http.state()``), plus ``_port``.
    http_state: dict[str, Any]


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
    handler = functools.partial(serve, log=log, state=state)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, "127.0.0.1", 0), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


def _repeat_frame() -> bytes:
    """One plausible metering frame, repeated forever: a quiet 48 kHz band."""
    return fake_metering.frame([-90.0] * 33, bandwidth=48000.0, transform_time=0.01)


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
    offering nothing. `scripts/gates/check_e2e_isolation.py` fails the build
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
        "HQPTUNER_POLL_INTERVAL": "0.1",
    }


def _startup_failure(reason: str, log_path: Path) -> str:
    output = log_path.read_text(errors="replace") if log_path.exists() else "<no output captured>"
    return f"e2e stack failed to start: {reason}\n--- app stdout/stderr ---\n{output}"


def _answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:  # noqa: S310 — literal loopback http URL
            return bool(response.status == 200)
    except OSError:
        return False


def _wait_for_ready(base_url: str, proc: "subprocess.Popen[bytes]", log_path: Path) -> None:
    """Poll until the app serves daemon-derived state, or fail loudly with the app's output.

    `/api/health` alone is not readiness. It reports on the connection manager
    and answers 200 before any lane has loaded anything (api/routes/status.py), while
    `/api/config` 503s `not yet loaded from daemon` until the first 8088 poll
    lands (api/deps.py). A stack yielded between those two moments hands the
    session its first fixture call in that window, and every test in the run
    errors in setup rather than failing on anything it asserts. So readiness is
    both: the app is up AND it has something from the daemon to serve.
    """
    urls = [f"{base_url}/api/health", f"{base_url}/api/config"]
    refusing = urls[0]
    deadline = time.monotonic() + READY_TIMEOUT
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(_startup_failure(f"app exited with status {proc.returncode}", log_path))
        still = [url for url in urls if not _answers(url)]
        if not still:
            return
        refusing = still[0]
        time.sleep(READY_POLL)
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
    directory, live-preset file and the captured startup log all land there, so
    nothing a test does reaches the repo's own `state/`.
    """
    control_state: dict[str, str] = dict(DEFAULTS)
    control_log: CommandLog = []
    control = spawn_control(control_state, control_log)
    http_state = fake_http.state()
    http = fake_http.spawn(http_state)
    metering = fake_metering.spawn_threaded_stream(_repeat_frame())
    proc: subprocess.Popen[bytes] | None = None
    try:
        control_port = next(control)
        next(http)
        metering_port = next(metering)
        listen_port = _free_port()
        log_path = tmp / "app.log"
        env = _app_env(listen_port, control_port, int(http_state["_port"]), metering_port, tmp)
        proc = _launch_app(env, log_path)
        base_url = f"http://127.0.0.1:{listen_port}"
        _wait_for_ready(base_url, proc, log_path)
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
        next(metering, None)
