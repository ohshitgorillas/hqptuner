"""The production event wait: an event set in time answers True, a deadline passing first answers False."""

import asyncio

from hqptuner.core.clock import wait_until


async def test_an_event_set_before_the_deadline_answers_true_and_an_unset_one_false_at_its_deadline() -> None:
    raised = asyncio.Event()
    asyncio.get_running_loop().call_soon(raised.set)
    assert (await wait_until(raised, 60.0), await wait_until(asyncio.Event(), 0)) == (True, False)
