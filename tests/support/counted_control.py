"""The Control API fake, served with its connections counted from the daemon's side of the wire.

``fake_control.serve_shared`` answers each connection; this wraps it so a case can read, off the fake rather than off
HQPTuner, when each connection was accepted on the manager's clock and how many are still held open. A connection
counts as open from its accept until the fake has read the client's hang-up and closed its own end.
"""

import asyncio
import functools
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fake_control import DEFAULTS, serve_shared
from virtual_clock import VirtualClock

#: Loop passes a hang-up is given to reach the fake: a loopback close arrives within a few, so the bound is reached
#: only when the client never hung up.
HANG_UP_PASSES = 50


@dataclass
class Connections:
    """What one fake daemon has seen of its clients: each accept's clock reading, and the connections still open."""

    clock: VirtualClock
    accepted_at: list[float] = field(default_factory=list)
    open: int = 0


@dataclass
class CountedDaemon:
    """A fake Control API daemon on a loopback port, its live State, and its connections."""

    port: int
    state: dict[str, str]
    connections: Connections


async def _serve_counted(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, state: dict[str, str], connections: Connections
) -> None:
    connections.accepted_at.append(connections.clock.monotonic())
    connections.open += 1
    try:
        await serve_shared(reader, writer, state)
    finally:
        connections.open -= 1


@asynccontextmanager
async def counted_daemon(clock: VirtualClock, **overrides: str) -> AsyncIterator[CountedDaemon]:
    """Serve a fake daemon whose State is ``DEFAULTS`` with ``overrides``, counting its connections on ``clock``."""
    state = {**DEFAULTS, **overrides}
    connections = Connections(clock)
    handler = functools.partial(_serve_counted, state=state, connections=connections)
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    try:
        yield CountedDaemon(int(server.sockets[0].getsockname()[1]), state, connections)
    finally:
        server.close()
        await server.wait_closed()


async def within_passes(done: Callable[[], bool]) -> bool:
    """Let the loop run until ``done`` holds, or ``HANG_UP_PASSES`` have gone by; whether it holds."""
    for _ in range(HANG_UP_PASSES):
        if done():
            break
        await asyncio.sleep(0)
    return done()


async def still_open(connections: Connections) -> int:
    """Let the loop run until the fake has seen every client hang up, or ``HANG_UP_PASSES`` have gone by; the
    connections it still holds open."""
    await within_passes(lambda: connections.open == 0)
    return connections.open
