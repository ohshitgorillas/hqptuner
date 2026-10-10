"""The clock every wait in the manager and its lanes paces on.

One pair of reads and waits, shared by the manager and every lane. Production takes the defaults below; the suite
hands in a clock it advances, so a retry, poll or deadline loop runs the same passes against the fakes without the
seconds.

The waits come in two kinds because the two kinds of caller differ in what they are for. ``sleep`` and ``wait`` are
a caller waiting on an outcome. ``pace`` is a background loop idling between passes. ``spawn`` starts such a loop,
so a clock that advances itself knows every loop that paces on it from the moment it exists. ``wait_for`` is a reply
awaited under a deadline, the one every Control API connect, send and read waits under.
"""

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


async def wait_until(event: asyncio.Event, seconds: float) -> bool:
    """Wait until ``event`` is set or ``seconds`` pass, and answer whether it was set."""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(event.wait(), seconds)
    return event.is_set()


async def pace_until(wake: asyncio.Event | None, seconds: float) -> bool:
    """Idle a background loop for ``seconds``, cut short by ``wake`` when it is given; answer whether it woke.

    A loop with no wake event of its own paces on one nobody sets, which is a plain sleep by another name.
    """
    return await wait_until(wake or asyncio.Event(), seconds)


def utc_now() -> datetime:
    """Answer the current wall-clock instant in UTC, for stamping what was written and when."""
    return datetime.now(UTC)


@dataclass(frozen=True)
class Clock:
    """The reads and waits one manager and its lanes pace on."""

    monotonic: Callable[[], float] = time.monotonic
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    wait: Callable[[asyncio.Event, float], Awaitable[bool]] = wait_until
    pace: Callable[[asyncio.Event | None, float], Awaitable[bool]] = pace_until
    spawn: Callable[[Coroutine[Any, Any, None]], asyncio.Task[None]] = asyncio.create_task
    now: Callable[[], datetime] = utc_now
    wait_for: Callable[[Awaitable[Any], float], Awaitable[Any]] = asyncio.wait_for
