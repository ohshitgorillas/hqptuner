"""A clock the suite advances (docs/testing.md rule 7), handed to the manager and the app at construction.

Time stands still while anything it knows of is still working. It knows a task once the task has waited on it, and a
background loop from the moment ``spawn`` starts it. When every such task is waiting on it and at least one of them
is waiting on an outcome (``sleep`` or ``wait``), time jumps to the earliest deadline and releases the waits due
there. Background idling alone (``pace``) never moves it, so a running poll loop with nothing waiting on an outcome
sits still instead of spinning. A task busy on a socket is not waiting on the clock, so time never moves under a
reply that is still in flight.

A reply wait (``wait_for``) is handed its operation's own result while HQPlayer answers, and no deadline runs. Once the
test says HQPlayer has fallen silent, each reply wait from then on abandons its operation and waits on the clock for its
deadline, as on a daemon that answers nothing more.

One clock per app or manager: each ``TestClient`` runs its app on an event loop of its own.
"""

import asyncio
import contextlib
import math
from collections.abc import Awaitable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from hqptuner.core.clock import Clock

#: The wall-clock instant a clock built without one answers with.
DEFAULT_INSTANT = datetime(2025, 1, 1, tzinfo=UTC)


class NotInTaskError(RuntimeError):
    """The virtual clock waits only inside a task."""


@dataclass
class _Wait:
    future: asyncio.Future[bool]
    deadline: float
    event: asyncio.Event | None
    outcome: bool

    @property
    def pending(self) -> bool:
        return not self.future.done() and not (self.event is not None and self.event.is_set())


@dataclass
class _Timeline:
    now: float = 0.0
    known: set[asyncio.Task[Any]] = field(default_factory=set)
    waits: dict[asyncio.Task[Any], _Wait] = field(default_factory=dict)
    idlers: list[tuple[asyncio.Future[None], asyncio.Task[Any] | None]] = field(default_factory=list)
    silent: bool = False

    def monotonic(self) -> float:
        return self.now

    async def wait_for[T](self, fut: Awaitable[T], seconds: float, /) -> T:
        if not self.silent:
            return await fut
        abandoned = asyncio.ensure_future(fut)
        abandoned.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await abandoned
        await self.park(seconds, None, outcome=True)
        raise TimeoutError(seconds)

    async def sleep(self, seconds: float) -> None:
        await self.park(seconds, None, outcome=True)

    async def wait(self, event: asyncio.Event, seconds: float) -> bool:
        return await self.park(seconds, event, outcome=True)

    async def pace(self, wake: asyncio.Event | None, seconds: float) -> bool:
        return await self.park(seconds, wake, outcome=False)

    def spawn(self, coro: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
        task = asyncio.get_running_loop().create_task(coro)
        self.know(task)
        return task

    async def idle(self) -> None:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[None] = loop.create_future()
        self.idlers.append((future, asyncio.current_task()))
        loop.call_soon(self.check)
        await future

    def know(self, task: asyncio.Task[Any]) -> None:
        if task not in self.known:
            self.known.add(task)
            task.add_done_callback(self.forget)

    def forget(self, task: asyncio.Task[Any]) -> None:
        self.known.discard(task)
        asyncio.get_running_loop().call_soon(self.check)

    async def park(self, seconds: float, event: asyncio.Event | None, *, outcome: bool) -> bool:
        if event is not None and event.is_set():
            return True
        if seconds <= 0:
            await asyncio.sleep(0)
            return event is not None and event.is_set()
        loop = asyncio.get_running_loop()
        task = asyncio.current_task()
        if task is None:
            raise NotInTaskError
        self.know(task)
        future: asyncio.Future[bool] = loop.create_future()
        self.waits[task] = _Wait(future, self.now + seconds, event, outcome)
        relay = None if event is None else loop.create_task(self.relay(event, future))
        loop.call_soon(self.check)
        try:
            return await future
        finally:
            del self.waits[task]
            if relay is not None:
                relay.cancel()
            loop.call_soon(self.check)

    @staticmethod
    async def relay(event: asyncio.Event, future: asyncio.Future[bool]) -> None:
        await event.wait()
        if not future.done():
            future.set_result(True)

    def check(self) -> None:
        pending = {task: wait for task, wait in self.waits.items() if wait.pending}
        live = {task for task in self.known if not task.done()}
        for future, caller in self.idlers:
            if not future.done() and live - {caller} <= pending.keys():
                future.set_result(None)
        self.idlers = [(future, caller) for future, caller in self.idlers if not future.done()]
        if not live <= pending.keys() or not any(wait.outcome for wait in pending.values()):
            return
        due = min(wait.deadline for wait in pending.values())
        if not math.isfinite(due):
            return
        self.now = max(self.now, due)
        for wait in pending.values():
            if wait.deadline <= self.now:
                wait.future.set_result(False)


class VirtualClock(Clock):
    """A ``Clock`` whose time moves only when everything it knows of is waiting on it."""

    _timeline: _Timeline

    def __init__(self, *, now: datetime = DEFAULT_INSTANT) -> None:
        """Start the timeline at zero; ``now`` is the fixed UTC instant every wall-clock read answers with."""
        timeline = _Timeline()
        super().__init__(
            monotonic=timeline.monotonic,
            sleep=timeline.sleep,
            wait=timeline.wait,
            pace=timeline.pace,
            spawn=timeline.spawn,
            now=lambda: now,
            wait_for=timeline.wait_for,
        )
        object.__setattr__(self, "_timeline", timeline)

    def fall_silent(self) -> None:
        """Let every reply wait from here on run out at its deadline, as on a daemon that answers nothing more."""
        self._timeline.silent = True

    async def idle(self) -> None:
        """Return once every task the clock knows of, other than the caller, is waiting on it."""
        await self._timeline.idle()

    async def advance(self, seconds: float) -> None:
        """Let ``seconds`` pass, then return once everything they released is waiting again."""
        await self._timeline.sleep(seconds)
        await self._timeline.idle()
