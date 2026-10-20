"""What a listener is shown when a request to HQPlayer's Control API (4321)
fails at the operating-system level: the connection is reset under a command.

The owner's spec: such a failure reads as a lead clause saying what HQPTuner
was doing, then a sentence naming where HQPlayer was looked for, in place of the
raw socket text or the internal `{what}: connection failed: {error}` form (`GetShapers:
connection failed: Connection lost` is the field report in
tests/engine/test_control_stall.py).

What is asserted is what the fixture put there: the host and port the app was
configured to reach, which the sentence carries as `host:port`.

The daemon is the repository's control fake, served on sockets that linger for
zero seconds, so the fake's `_close` knob resets the connection (RST) instead of
closing it (FIN): the client's read fails in the socket layer, the way a daemon
that went away under a command fails it. Nothing here waits on a deadline.

Two surfaces carry the failure to the user: a matrix profile switch and a live
write, each refused with a string `detail`.
"""

import asyncio
import functools
import socket
import struct
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from apps import live_app
from fake_control import DEFAULTS, CommandLog, serve_shared
from fastapi.testclient import TestClient

#: The address the app is configured to reach HQPlayer at, and the one the fake
#: daemon listens on.
HOST = "127.0.0.1"

#: `SO_LINGER` on, for zero seconds: closing such a socket resets the connection.
RESET_ON_CLOSE = struct.pack("ii", 1, 0)

#: The manager's background poll, parked past the end of any case, so the knob
#: that resets the connection is tripped by the case's own request and never by
#: a poll that would leave the request failing for want of a connection instead.
#: Connecting reads every enumeration once, and the next re-read waits this long
#: on the app's virtual clock; the heartbeat between polls reads only State and
#: Status, which no knob here touches.
PARKED_POLL_INTERVAL = 3600.0

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


def _resetting_app(tmp_path: Path, command: str) -> Iterator[tuple[TestClient, int]]:
    """The control-only app on a daemon that answers until the app has loaded,
    then resets the connection under ``command`` without answering it."""
    state = dict(DEFAULTS)
    log: CommandLog = []
    daemon = _resetting_daemon(state, log)
    port = next(daemon)
    app = live_app(port, tmp_path, poll_interval=PARKED_POLL_INTERVAL)
    client = next(app)
    state["_close"] = command
    yield client, port
    next(app, None)
    next(daemon, None)


def _detail_text(body: object) -> str:
    """The refusal's `detail`, when it is a sentence."""
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail if isinstance(detail, str) else NO_TEXT


def _switch_reset(tmp_path: Path) -> Iterator[Failure]:
    for client, port in _resetting_app(tmp_path, SWITCH_COMMAND):
        body = client.post("/api/matrix/profile", json={"action": "switch", "name": SWITCHED_PROFILE}).json()
        yield Failure(_detail_text(body), f"{HOST}:{port}")


def _live_write_reset(tmp_path: Path) -> Iterator[Failure]:
    for client, port in _resetting_app(tmp_path, LIVE_SETTER):
        body = client.post("/api/config/live", json={"fields": {LIVE_FIELD: LIVE_VALUE}}).json()
        yield Failure(_detail_text(body), f"{HOST}:{port}")


SURFACES: dict[str, Callable[[Path], Iterator[Failure]]] = {
    "matrix-switch": _switch_reset,
    "live-write": _live_write_reset,
}


@pytest.fixture(params=list(SURFACES))
def failure(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Failure]:
    yield from SURFACES[request.param](tmp_path)


def test_a_reset_control_connection_names_the_address_hqplayer_was_looked_for_at(failure: Failure) -> None:
    assert failure.address in failure.text
