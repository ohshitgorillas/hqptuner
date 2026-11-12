"""A metering dial that never completes: given up at its timeout, and dialed again after the backoff.

The reader runs directly on a ``VirtualClock`` the test has told to fall silent, so a dial to the 4322 stream waits
on the clock for the deadline it began with and never fails at once, the way a refused port would. The engine plays and
the advisor reads, so the reader wants the stream from its first pass. When each dial wait began is the clock's own
record; whether the reader is still inside a dial is read off whether it ends when it is asked to stop, which a reader
backing off does and one still dialing does not.
"""

import asyncio

import pytest
from virtual_clock import VirtualClock

from hqptuner.engine.metering import RECONNECT_DELAY, MeteringReader
from hqptuner.engine.trackcontext import TrackContext

#: The reader's request timeout, wall seconds.
TIMEOUT = 3.0

#: Never dialed: the silent clock abandons the connection attempt before it starts.
ADDRESS = ("127.0.0.1", 0)

PLAYING = TrackContext(filter=None, junk_filter=None, samplerate=None, sdm=False, playing=True)


def _silent_reader() -> tuple[VirtualClock, MeteringReader]:
    """A reader that reads the stream of a playing engine on a clock that answers no dial."""
    clock = VirtualClock()
    clock.fall_silent()
    return clock, MeteringReader(ADDRESS, lambda: PLAYING, clock=clock, timeout=TIMEOUT, advisor=True)


async def _ended_when_asked_to_stop_after(seconds: float) -> bool:
    """Whether the reader's task ends as soon as it is asked to stop ``seconds`` into its first dial."""
    clock, reader = _silent_reader()
    task = clock.spawn(reader.run())
    await clock.advance(seconds)
    reader.stop()
    await clock.idle()
    ended = task.done()
    await clock.advance(TIMEOUT)
    await asyncio.gather(task, return_exceptions=True)
    return ended


@pytest.mark.parametrize(
    ("seconds", "ended"),
    [
        pytest.param(TIMEOUT - 1.0, False, id="before the timeout"),
        pytest.param(TIMEOUT, True, id="at the timeout"),
    ],
)
async def test_a_dial_that_never_completes_is_given_up_once_its_timeout_has_passed(
    seconds: float, *, ended: bool
) -> None:
    assert await _ended_when_asked_to_stop_after(seconds) is ended


async def test_a_dial_given_up_is_followed_by_another_after_the_reconnect_backoff() -> None:
    clock, reader = _silent_reader()
    task = clock.spawn(reader.run())
    await clock.advance(TIMEOUT + RECONNECT_DELAY)
    began = clock.reply_waits_began()
    reader.stop()
    await clock.advance(TIMEOUT)
    await asyncio.gather(task, return_exceptions=True)
    assert began == (0.0, TIMEOUT + RECONNECT_DELAY)
