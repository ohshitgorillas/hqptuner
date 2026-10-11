"""What the push feed reads, and what a subscriber attaching receives, at the feed itself.

Each case builds the feed on one event whose read answers from a table the case
holds and counts its calls, and runs the feed's loop as a task on the virtual
clock with an event standing for the manager's edge.
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import pytest
from virtual_clock import VirtualClock

from hqptuner.api.push import PushFeed, Source

NAME = "probe"
FIRST = "first"
MOVED = "moved"


@dataclass
class Probe:
    """The table one event's read answers from, and how many times it was read."""

    table: dict[str, str] = field(default_factory=lambda: {"value": FIRST})
    reads: int = 0

    def read(self) -> dict[str, str]:
        self.reads += 1
        return dict(self.table)


@pytest.fixture
def probe() -> Probe:
    return Probe()


@pytest.fixture
def changed() -> asyncio.Event:
    """The edge the manager would set after a poll pass."""
    return asyncio.Event()


@pytest.fixture
async def feed(probe: Probe, clock: VirtualClock, changed: asyncio.Event) -> AsyncIterator[PushFeed]:
    """The feed on `probe`'s one event, its loop running and idle on `clock`."""
    built = PushFeed([Source(NAME, probe.read, snapshot=False)])
    task = clock.spawn(built.run(clock, changed))
    await clock.idle()
    yield built
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


def _first_value(queue: "asyncio.Queue[str]") -> object:
    """The ``value`` carried by the first text queued, or None where nothing was queued."""
    text = "" if queue.empty() else queue.get_nowait()
    data = next((line.removeprefix("data: ") for line in text.splitlines() if line.startswith("data: ")), "{}")
    body = json.loads(data)
    return body.get("value") if isinstance(body, dict) else None


async def test_a_later_subscriber_first_receives_the_value_that_moved_while_none_listened(
    feed: PushFeed, probe: Probe, clock: VirtualClock
) -> None:
    feed.unsubscribe(feed.subscribe())
    await clock.idle()
    probe.table["value"] = MOVED
    assert _first_value(feed.subscribe()) == MOVED
