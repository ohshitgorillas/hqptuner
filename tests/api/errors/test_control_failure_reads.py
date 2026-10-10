"""What a listener is shown when a request to HQPlayer's Control API (4321)
fails at the operating-system level: the connection is reset under a command.

The owner's spec: such a failure reads as a lead clause saying what HQPTuner
was doing, then a sentence naming where HQPlayer was looked for, in place of the
raw socket text or the internal `{what}: connection failed: {error}` form, whose
`{what}` is the Control API command in flight (`GetShapers: connection failed:
Connection lost` is the field report in tests/engine/test_control_stall.py).

What is asserted is what the fixture and the operating system put there: the
host and port the app was configured to reach, which the sentence carries as
`host:port`; the wire name of the command, which it no longer carries; and the
operating system's own text for a reset connection, which it no longer carries
either.

The daemon is the repository's control fake, served on sockets that linger for
zero seconds, so the fake's `_close` knob resets the connection (RST) instead of
closing it (FIN): the client's read fails in the socket layer, the way a daemon
that went away under a command fails it. Nothing here waits on a deadline.

Two surfaces carry the failure to the user: a matrix profile switch, refused
with a `detail`, and a live write, whose report entry carries an `error`.
"""

import asyncio
import errno
import functools
import os
import socket
import struct
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from apps import live_app, wait_for_api
from fake_control import DEFAULTS, CommandLog, serve_shared
from fastapi.testclient import TestClient

#: The address the app is configured to reach HQPlayer at, and the one the fake
#: daemon listens on.
HOST = "127.0.0.1"

#: `SO_LINGER` on, for zero seconds: closing such a socket resets the connection.
RESET_ON_CLOSE = struct.pack("ii", 1, 0)

#: The operating system's own words for a reset connection: socket text, never
#: HQPTuner's.
RESET_TEXT = os.strerror(errno.ECONNRESET)

#: The manager's background poll, parked past the end of any case, so the knob
#: that resets the connection is tripped by the case's own request and never by
#: a poll that would leave the request failing for want of a connection instead.
PARKED_POLL_INTERVAL = 3600.0

#: The last Control API command of both the connect-and-load and the poll in a
#: control-only app; its second appearance in the daemon's log is the first
#: background poll finishing, after which a knob flipped on the daemon is seen by
#: the case's request alone.
FIRST_POLL_SENTINEL = "MatrixListProfiles"

#: A matrix profile the fake daemon lists, and the command that switches to it.
SWITCHED_PROFILE = "Default"
SWITCH_COMMAND = "MatrixSetProfile"

#: A live setting whose setter is one command with nothing else in the batch.
LIVE_FIELD = "junk_filter"
LIVE_VALUE = "1"
LIVE_SETTER = "SetJunkFilter"

#: What a response that carries no failure text reads as: no case expects it, so
#: a shape the extractors do not find fails an assertion rather than raising.
NO_TEXT = ""


@dataclass(frozen=True)
class Failure:
    """One failed request as the user received it, beside what the fixture knows."""

    text: str
    """The failure text the response carries for the user."""
    address: str
    """``host:port`` the app was configured to reach HQPlayer at."""
    command: str
    """The Control API command the request needed."""


async def _serve_resetting(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, state: dict[str, str], log: CommandLog
) -> None:
    """The repository's control fake on a socket whose close is a reset."""
    writer.get_extra_info("socket").setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, RESET_ON_CLOSE)
    await serve_shared(reader, writer, state, log)


def _resetting_daemon(state: dict[str, str], log: CommandLog) -> Iterator[int]:
    """Serve the fake from its own thread, as the suite's threaded daemon does,
    so the app's loop inside `TestClient` can reach it. Yields the port."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    handler = functools.partial(_serve_resetting, state=state, log=log)
    server = asyncio.run_coroutine_threadsafe(asyncio.start_server(handler, HOST, 0), loop).result()
    port: int = server.sockets[0].getsockname()[1]
    yield port
    loop.call_soon_threadsafe(server.close)
    asyncio.run_coroutine_threadsafe(server.wait_closed(), loop).result()
    loop.call_soon_threadsafe(loop.stop)
    thread.join()
    loop.close()


def _await_first_poll(client: TestClient, log: CommandLog) -> None:
    def first_poll_done(c: TestClient) -> bool:
        c.get("/api/health")
        return sum(1 for name, _ in log if name == FIRST_POLL_SENTINEL) >= 2

    wait_for_api(client, first_poll_done)


def _resetting_app(tmp_path: Path, command: str) -> Iterator[tuple[TestClient, int]]:
    """The control-only app on a daemon that answers until the app has loaded,
    then resets the connection under ``command`` without answering it."""
    state = dict(DEFAULTS)
    log: CommandLog = []
    daemon = _resetting_daemon(state, log)
    port = next(daemon)
    app = live_app(port, tmp_path, poll_interval=PARKED_POLL_INTERVAL)
    client = next(app)
    _await_first_poll(client, log)
    state["_close"] = command
    yield client, port
    next(app, None)
    next(daemon, None)


def _detail_text(body: object) -> str:
    """The refusal's `detail`, when it is a sentence."""
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail if isinstance(detail, str) else NO_TEXT


def _live_field_text(body: object, field: str) -> str:
    """The failure text a live write carries for ``field``: its report entry's
    `error` in a 200 body, or the refusal's per-field reason or sentence."""
    if not isinstance(body, dict):
        return NO_TEXT
    report = body.get("report")
    entries = report.get("live", []) if isinstance(report, dict) else []
    errors = [e.get("error") for e in entries if isinstance(e, dict) and e.get("setting") == field]
    if errors and isinstance(errors[0], str):
        return errors[0]
    detail = body.get("detail")
    if isinstance(detail, dict) and isinstance(detail.get(field), str):
        return str(detail[field])
    return _detail_text(body)


def _switch_reset(tmp_path: Path) -> Iterator[Failure]:
    for client, port in _resetting_app(tmp_path, SWITCH_COMMAND):
        body = client.post("/api/matrix/profile", json={"action": "switch", "name": SWITCHED_PROFILE}).json()
        yield Failure(_detail_text(body), f"{HOST}:{port}", SWITCH_COMMAND)


def _live_write_reset(tmp_path: Path) -> Iterator[Failure]:
    for client, port in _resetting_app(tmp_path, LIVE_SETTER):
        body = client.post("/api/config/live", json={"fields": {LIVE_FIELD: LIVE_VALUE}}).json()
        yield Failure(_live_field_text(body, LIVE_FIELD), f"{HOST}:{port}", LIVE_SETTER)


SURFACES: dict[str, Callable[[Path], Iterator[Failure]]] = {
    "matrix-switch": _switch_reset,
    "live-write": _live_write_reset,
}


@pytest.fixture(params=list(SURFACES))
def failure(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Failure]:
    yield from SURFACES[request.param](tmp_path)


def test_a_reset_control_connection_names_the_address_hqplayer_was_looked_for_at(failure: Failure) -> None:
    assert failure.address in failure.text


def test_a_reset_control_connection_does_not_show_the_user_the_control_command(failure: Failure) -> None:
    assert failure.command not in failure.text


def test_a_reset_control_connection_does_not_show_the_user_the_socket_text(failure: Failure) -> None:
    assert RESET_TEXT not in failure.text
