"""HQPlayer falling silent while a reply is already being awaited, as the suite's clock meets it.

A request sent before the test silences HQPlayer is still waiting on its reply at that moment. The daemon answers
nothing more, so that reply never counts: the wait runs out on the clock at the deadline it began with, the way it
would against a real daemon, and anything waiting behind it, a shutdown's grace included, is free to elapse.
"""

import asyncio
from dataclasses import dataclass

import pytest
from virtual_clock import VirtualClock

#: The per-request deadline, in virtual seconds: the production request timeout.
REQUEST_TIMEOUT = 5.0
#: Virtual seconds that pass before the request goes out, so the wait does not begin at the clock's zero.
BEFORE_REQUEST = 2.0
#: Virtual seconds that pass between the request going out and HQPlayer falling silent.
SENT_BEFORE_SILENCE = 1.0
#: How long the test waits on the clock for the reply wait to end; far past any deadline it could run out at.
CEILING = 10 * REQUEST_TIMEOUT
#: What the daemon would have answered, had it still been answering.
LATE_ANSWER = "<GetInfo/>"


@dataclass(frozen=True)
class Silenced:
    """How a reply wait under way when HQPlayer fell silent ended, and the clock readings either side of it."""

    awaiting: asyncio.Task[str]
    began: float
    ended: float


async def _silenced_mid_reply(clock: VirtualClock) -> Silenced:
    """Start a reply wait, let ``SENT_BEFORE_SILENCE`` pass, silence HQPlayer, then let the answer arrive.

    The test waits on the clock, never on the task, so the clock sees it waiting and can move to the reply's deadline.
    """
    sent = asyncio.Event()
    answered = asyncio.Event()
    finished = asyncio.Event()

    async def reply() -> str:
        sent.set()
        await answered.wait()
        return LATE_ANSWER

    async def request() -> str:
        answer: str = await clock.wait_for(reply(), REQUEST_TIMEOUT)
        return answer

    await clock.sleep(BEFORE_REQUEST)
    began = clock.monotonic()
    awaiting = asyncio.create_task(request())
    awaiting.add_done_callback(lambda _: finished.set())
    await sent.wait()
    await clock.sleep(SENT_BEFORE_SILENCE)
    clock.fall_silent()
    answered.set()
    await clock.wait(finished, CEILING)
    awaiting.cancel()
    await asyncio.wait({awaiting})
    return Silenced(awaiting, began, clock.monotonic())


async def test_a_reply_awaited_when_hqplayer_falls_silent_runs_out_instead_of_taking_a_late_answer() -> None:
    silenced = await _silenced_mid_reply(VirtualClock())
    with pytest.raises(TimeoutError):
        silenced.awaiting.result()


async def test_a_reply_awaited_when_hqplayer_falls_silent_runs_out_at_the_deadline_it_began_with() -> None:
    silenced = await _silenced_mid_reply(VirtualClock())
    assert silenced.ended - silenced.began == REQUEST_TIMEOUT
