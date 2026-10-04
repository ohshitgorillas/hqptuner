"""The production event wait: an event set in time answers True, a deadline passing first answers False."""

import asyncio

import pytest

from hqptuner.core.clock import wait_until


@pytest.mark.parametrize(
    ("set_soon", "seconds", "expected"),
    [(True, 60.0, True), (False, 0, False)],
    ids=["set before the deadline", "never set"],
)
async def test_wait_until_answers_whether_the_event_was_set_before_the_deadline(
    *, set_soon: bool, seconds: float, expected: bool
) -> None:
    event = asyncio.Event()
    if set_soon:
        asyncio.get_running_loop().call_soon(event.set)
    assert await wait_until(event, seconds) is expected
