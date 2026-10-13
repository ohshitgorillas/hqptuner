"""Stopping HQPTuner ends the process cleanly, and starting it again brings the UI back.

A container stop sends the app SIGTERM. The app has to run its shutdown to the
end on its own, background loops included, and leave the process; a shutdown
that waits on a loop that never finishes keeps the process alive until it is
killed. Started again on the same port and the same state, the app has to come
back up and serve the page, with the page's live feed answered.

Policy notes:

- Characterization of existing behavior: these pin what the app does now, as
  regression cover.
- The app under test is a stack of this module's own, never the session stack,
  since stopping it is the point. The wire fakes stay up across the restart,
  the way the engine stays up while HQPTuner restarts.
- Waits are bounded: the port the app bound is read from its output under a
  ceiling, the exit is a process wait under a ceiling and the page's feed is an
  awaited response under a ceiling.
"""

import http.client
import json
import os
import signal
import socket
import subprocess
import tempfile
import typing
import urllib.parse
from collections.abc import Iterator
from dataclasses import dataclass, fields
from pathlib import Path

import fake_http
import fake_metering
import pytest
from fake_control import DEFAULTS
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, Response

from e2e.support import stack as stack_support
from hqptuner.config import Config

#: Ceiling on the app answering with daemon-derived state after a start, s.
READY_TIMEOUT = 30.0

#: Ceiling on one readiness probe of the app, which is on loopback, s.
PROBE_TIMEOUT = 1.0

#: Ceiling on the app leaving after SIGTERM, s. Its own shutdown bounds every
#: background loop and open connection well inside this; it is a hang guard.
STOP_TIMEOUT = 30.0

#: Ceiling on the restarted page opening its live feed, ms.
LOAD_TIMEOUT_MS = 15000.0

#: The live feed the page opens on load; every snapshot it shows arrives on it.
PUSH_PATH = "/api/push"

#: An answered request.
HTTP_OK = 200

#: The one path knob the app only reads: shipped metadata the app needs as it ships.
READ_ONLY_PATHS = frozenset({"data_dir"})


@dataclass
class App:
    """An app subprocess plus what it takes to start it again exactly as before."""

    proc: "subprocess.Popen[bytes]"
    output: stack_support.AppOutput
    port: int
    base_url: str
    env: dict[str, str]
    state: Path
    engine: stack_support.Stack


class AppDidNotStartError(RuntimeError):
    """The app gave no daemon-derived answer within the start ceiling; carries its captured output."""

    def __init__(self, log_path: Path) -> None:
        """Name the ceiling and attach everything the app printed."""
        output = log_path.read_text(errors="replace")
        super().__init__(f"app never came up within {READY_TIMEOUT:.0f}s\n{output}")


@pytest.fixture
def clean_slate() -> None:
    """Nothing to reset: these tests never touch the session stack, so they do not start it either."""


def _state_paths(state: Path) -> dict[str, str]:
    """Every path the app writes, redirected under `state`, so nothing lands in the checkout's own `state/`."""
    hints = typing.get_type_hints(Config)
    return {
        f"HQPTUNER_{knob.name.upper()}": str(state / knob.name)
        for knob in fields(Config)
        if hints[knob.name] is Path and knob.name not in READ_ONLY_PATHS
    }


def _app_env(control_port: int, http_port: int, metering_port: int, state: Path) -> dict[str, str]:
    """The app's whole configuration: the fakes, a scratch state area, fast polling, and listen port 0.

    Port 0 has the first run bind a port of the kernel's choosing, read back from its output.
    Credentials are arbitrary, but non-empty: the app opens the 8088 lane only with a pair to open it with.
    """
    return {
        **os.environ,
        **_state_paths(state),
        "HQPTUNER_LISTEN_HOST": "127.0.0.1",
        "HQPTUNER_LISTEN_PORT": "0",
        "HQPTUNER_LOG_LEVEL": stack_support.APP_LOG_LEVEL,
        "HQPTUNER_HQP_HOST": "127.0.0.1",
        "HQPTUNER_HQP_CONTROL_PORT": str(control_port),
        "HQPTUNER_HQP_HTTP_PORT": str(http_port),
        "HQPTUNER_HQP_METERING_PORT": str(metering_port),
        "HQPTUNER_HQP_USERNAME": "hqplayer",
        "HQPTUNER_HQP_PASSWORD": "password",
        "HQPTUNER_POLL_INTERVAL": "0.1",
        "HQPTUNER_ALARM_THRESHOLD": "0.05",
    }


def _answers(port: int, path: str) -> bool:
    """A 200 from `path` on the app, and on `/api/health` the app's own `ready` flag with it."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=PROBE_TIMEOUT)
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        if response.status != HTTP_OK:
            return False
        return path != "/api/health" or bool(json.loads(response.read()).get("ready"))
    except OSError:
        return False
    finally:
        conn.close()


def _ready(app: App) -> bool:
    """Whether the app is up with something from the daemon to serve, woken by every command it sends the engine."""

    def serving() -> bool:
        return app.proc.poll() is None and all(_answers(app.port, path) for path in ("/api/health", "/api/config"))

    return app.engine.wait_for_command(serving, timeout=READY_TIMEOUT)


def _end(proc: "subprocess.Popen[bytes]", output: stack_support.AppOutput) -> None:
    """Terminate the app if it is still running and reap it, killing it if it outstays the stop ceiling.

    Its output is then read to the end, so nothing is still writing the log when the state directory goes.
    """
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=STOP_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    output.close()


@pytest.fixture
def app() -> Iterator[App]:
    """The control and config fakes and one running app on them, its state in a directory removed at teardown.

    The metering port is one nothing serves on, held by a bound socket that never listens for the fixture's life.
    """
    control_state = dict(DEFAULTS)
    control_log = stack_support.NotifyingLog()
    control = stack_support.spawn_control(control_state, control_log)
    http_state = stack_support.NotifyingState(fake_http.state())
    http = fake_http.spawn(http_state)
    scratch = tempfile.TemporaryDirectory(prefix="hqptuner-restart-")
    unserved = socket.socket()
    launched: tuple[subprocess.Popen[bytes], stack_support.AppOutput] | None = None
    running: App | None = None
    try:
        control_port = next(control)
        next(http)
        state = Path(scratch.name)
        unserved.bind(("127.0.0.1", 0))
        env = _app_env(control_port, int(http_state["_port"]), unserved.getsockname()[1], state)
        launched = stack_support.launch_app(env, state / "app-1.log")
        proc, output = launched
        port = output.port(READY_TIMEOUT)
        if port is None:
            raise AppDidNotStartError(state / "app-1.log")
        base_url = f"http://127.0.0.1:{port}"
        engine = stack_support.Stack(base_url, control_log, control_state, http_state, fake_metering.Stream())
        rerun_env = {**env, "HQPTUNER_LISTEN_PORT": str(port)}
        running = App(proc, output, port, base_url, rerun_env, state, engine)
        if not _ready(running):
            raise AppDidNotStartError(state / "app-1.log")
        yield running
    finally:
        if running is not None:
            launched = (running.proc, running.output)
        if launched is not None:
            _end(*launched)
        unserved.close()
        next(control, None)
        next(http, None)
        scratch.cleanup()


def _stop(app: App) -> int | None:
    """Send the app SIGTERM and return its exit status, or None if it is still running at the ceiling."""
    app.proc.send_signal(signal.SIGTERM)
    try:
        return app.proc.wait(timeout=STOP_TIMEOUT)
    except subprocess.TimeoutExpired:
        return None


def _restart(app: App) -> str | None:
    """Stop the app, start it again on the same port and state, and return why it did not come back, or None.

    The new process replaces the old one on `app`, so teardown ends whichever is running. The restart is handed
    the port the first run bound, and is held to having bound that same port.
    """
    if _stop(app) is None:
        return f"first run still running {STOP_TIMEOUT:.0f}s after SIGTERM"
    app.output.close()
    log_path = app.state / "app-2.log"
    app.proc, app.output = stack_support.launch_app(app.env, log_path)
    if app.output.port(READY_TIMEOUT) != app.port:
        return f"restart did not listen on the first run's port {app.port}\n{log_path.read_text(errors='replace')}"
    if not _ready(app):
        return f"restart never came up within {READY_TIMEOUT:.0f}s\n{log_path.read_text(errors='replace')}"
    return None


def _restarted_feed_status(page: Page, app: App) -> int | str:
    """Restart the app, open the page on it, and return the status its live feed was answered with."""
    failed = _restart(app)
    if failed is not None:
        return failed

    def _is_feed(response: Response) -> bool:
        return urllib.parse.urlsplit(response.url).path == PUSH_PATH

    try:
        with page.expect_response(_is_feed, timeout=LOAD_TIMEOUT_MS) as answered:
            page.goto(app.base_url)
    except PlaywrightError as exc:
        return f"page on the restarted app opened no answered feed: {exc.message}"
    return answered.value.status


def test_a_restarted_app_serves_the_page_its_live_feed(page: Page, app: App) -> None:
    """Started again on the same port and state after a stop, the app serves the page and answers its live feed."""
    assert _restarted_feed_status(page, app) == HTTP_OK
